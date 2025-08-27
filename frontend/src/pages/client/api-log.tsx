'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import apiClient from '@/lib/apiClient'

interface ApiLog {
  id: string
  url: string
  statusCode: number
  errorMessage?: string
  responseBody?: string
  createdAt: string
  respondedAt?: string
}

type StatusFilter = 'all' | 'success' | 'failure'

const JKT_TZ = 'Asia/Jakarta'
const JKT_OFFSET_MS = 7 * 60 * 60 * 1000 // UTC+07 (no DST)

// ---------- Helpers Asia/Jakarta ----------
function jktInputStringFromDate(dateUtc: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: JKT_TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(dateUtc)
  const m: Record<string,string> = {}; parts.forEach(p => m[p.type] = p.value)
  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`
}
function jktISOStringFromInput(input?: string) {
  if (!input) return undefined
  const [datePart, timePart='00:00'] = input.split('T')
  const [y,m,d] = datePart.split('-').map(Number)
  const [hh,mm] = timePart.split(':').map(Number)
  const ms = Date.UTC(y, (m??1)-1, d??1, hh??0, mm??0) - JKT_OFFSET_MS
  return new Date(ms).toISOString()
}
function fmtJKT(iso?: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('id-ID', {
    timeZone: JKT_TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}
function pad2(n:number){ return String(n).padStart(2,'0') }
function parseJkt(input?: string){
  if(!input) return null
  const [datePart, timePart='00:00'] = input.split('T')
  const [y,m,d] = datePart.split('-').map(Number)
  const [hh,mm] = timePart.split(':').map(Number)
  return {y,m,d,hh,mm}
}
function partsToInput(y:number,m:number,d:number,hh:number,mm:number){
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}`
}
function getDaysInMonthJKT(year:number, mon1to12:number){
  const firstMs = Date.UTC(year, mon1to12-1, 1) - JKT_OFFSET_MS
  const nextMs  = Date.UTC(year, mon1to12,   1) - JKT_OFFSET_MS
  const startWeekday = new Date(firstMs).getUTCDay() // 0 Sun..6 Sat (JKT)
  const days = Math.round((nextMs-firstMs)/(24*3600*1000))
  return { startWeekday, days }
}
function cmpDate(y:number,m:number,d:number){ return y*10000 + m*100 + d }

// ---------- Range Picker (single popover, no lib) ----------
function useOnClickOutside<T extends HTMLElement>(ref: React.RefObject<T>, cb: ()=>void){
  useEffect(()=>{
    function onDown(e:MouseEvent){
      if(!ref.current) return
      if(!ref.current.contains(e.target as Node)) cb()
    }
    document.addEventListener('mousedown', onDown)
    return ()=>document.removeEventListener('mousedown', onDown)
  },[ref,cb])
}

function RangeDateTimePicker({
  startValue, endValue, onApply
}:{
  startValue: string, endValue: string,
  onApply: (s:string, e:string)=>void
}){
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  useOnClickOutside(popRef, ()=>setOpen(false))

  // internal editing state
  const startP = parseJkt(startValue) ?? parseJkt(jktInputStringFromDate(new Date()))!
  const endP   = parseJkt(endValue)   ?? parseJkt(jktInputStringFromDate(new Date()))!

  const [sy,setSy] = useState(startP.y); const [sm,setSm] = useState(startP.m); const [sd,setSd] = useState(startP.d)
  const [sh,setSh] = useState(startP.hh);const [smin,setSmin] = useState(startP.mm)
  const [ey,setEy] = useState(endP.y);   const [em,setEm] = useState(endP.m);   const [ed,setEd] = useState(endP.d)
  const [eh,setEh] = useState(endP.hh);  const [emin,setEmin] = useState(endP.mm)

  // calendar view month/year
  const [vy, setVy] = useState(startP.y)
  const [vm, setVm] = useState(startP.m)

  // selection flow state
  const [anchor, setAnchor] = useState<null | {y:number,m:number,d:number}>(null) // first click

  // reflect external when popup opened
  useEffect(()=>{
    if(!open) return
    const sp = parseJkt(startValue); const ep = parseJkt(endValue)
    if(sp){ setSy(sp.y); setSm(sp.m); setSd(sp.d); setSh(sp.hh); setSmin(sp.mm); setVy(sp.y); setVm(sp.m) }
    if(ep){ setEy(ep.y); setEm(ep.m); setEd(ep.d); setEh(ep.hh); setEmin(ep.mm) }
    setAnchor(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open])

  const { startWeekday, days } = useMemo(()=>getDaysInMonthJKT(vy, vm),[vy, vm])

  const hasRange = useMemo(()=>{
    const sC = cmpDate(sy,sm,sd), eC = cmpDate(ey,em,ed)
    return sC <= eC
  },[sy,sm,sd,ey,em,ed])

  function clickDay(day:number){
    if(!anchor){
      // first click -> set start (00:00) and clear end to same day (23:59)
      setSy(vy); setSm(vm); setSd(day); setSh(0); setSmin(0)
      setEy(vy); setEm(vm); setEd(day); setEh(23); setEmin(59)
      setAnchor({y:vy,m:vm,d:day})
    }else{
      // second click -> set end, ensure ordering (swap if needed)
      const aC = cmpDate(anchor.y, anchor.m, anchor.d)
      const bC = cmpDate(vy, vm, day)
      if(bC < aC){
        // swap
        setEy(anchor.y); setEm(anchor.m); setEd(anchor.d); setEh(23); setEmin(59)
        setSy(vy); setSm(vm); setSd(day); setSh(0);  setSmin(0)
      }else{
        setEy(vy); setEm(vm); setEd(day) // keep end time as currently chosen
      }
      setAnchor(null)
    }
  }

  function isSelected(y:number,m:number,d:number){
    const c = cmpDate(y,m,d)
    const s = cmpDate(sy,sm,sd)
    const e = cmpDate(ey,em,ed)
    return c===s || c===e
  }
  function inRange(y:number,m:number,d:number){
    const c = cmpDate(y,m,d)
    const s = cmpDate(sy,sm,sd)
    const e = cmpDate(ey,em,ed)
    return s<=c && c<=e
  }

  const apply = () => {
    // guard: both endpoints must exist & ordered
    const s = partsToInput(sy,sm,sd,sh,smin)
    const e = partsToInput(ey,em,ed,eh,emin)
    const sNum = cmpDate(sy,sm,sd), eNum = cmpDate(ey,em,ed)
    if (sNum > eNum) return // shouldn't happen due to logic, just guard
    onApply(s, e)
    setOpen(false)
  }
  const clear = () => {
    // set to last 24h as sensible default
    const now = new Date()
    const endS = jktInputStringFromDate(now)
    const startS = jktInputStringFromDate(new Date(now.getTime()-24*3600*1000))
    const sp = parseJkt(startS)!; const ep = parseJkt(endS)!
    setSy(sp.y); setSm(sp.m); setSd(sp.d); setSh(sp.hh); setSmin(sp.mm)
    setEy(ep.y); setEm(ep.m); setEd(ep.d); setEh(ep.hh); setEmin(ep.mm)
    setVy(sp.y); setVm(sp.m); setAnchor(null)
  }

  const label = `${partsToInput(sy,sm,sd,sh,smin).replace('T',' ')} — ${partsToInput(ey,em,ed,eh,emin).replace('T',' ')}`

  return (
    <div className="relative" ref={popRef}>
      <label className="mb-1 block text-xs text-neutral-400">Date range (WIB)</label>
      <button
        type="button"
        onClick={()=>setOpen(v=>!v)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-left text-sm text-neutral-100 hover:border-neutral-600"
        title="Klik untuk pilih rentang tanggal & jam (WIB)"
      >
        {label}
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-[28rem] rounded-2xl border border-neutral-800 bg-neutral-900 p-3 shadow-xl">
          {/* Header month nav */}
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg px-2 py-1 text-neutral-300 ring-1 ring-neutral-700 hover:bg-neutral-800"
                onClick={()=>{
                  const nm = vm-1; if(nm<1){ setVm(12); setVy(vy-1) } else setVm(nm)
                }}
                aria-label="Prev month"
              >‹</button>
              <div className="text-sm text-neutral-200">
                {new Date(Date.UTC(vy, vm-1, 1)).toLocaleString('id-ID',{month:'long'})} {vy}
              </div>
              <button
                className="rounded-lg px-2 py-1 text-neutral-300 ring-1 ring-neutral-700 hover:bg-neutral-800"
                onClick={()=>{
                  const nm = vm+1; if(nm>12){ setVm(1); setVy(vy+1) } else setVm(nm)
                }}
                aria-label="Next month"
              >›</button>
            </div>
            <button
              className="rounded-lg px-2 py-1 text-xs text-neutral-300 ring-1 ring-neutral-700 hover:bg-neutral-800"
              onClick={()=>{
                const now = new Date()
                const s = jktInputStringFromDate(new Date(now.getTime()-24*3600*1000))
                const e = jktInputStringFromDate(now)
                const sp = parseJkt(s)!; const ep = parseJkt(e)!
                setSy(sp.y); setSm(sp.m); setSd(sp.d); setSh(sp.hh); setSmin(sp.mm)
                setEy(ep.y); setEm(ep.m); setEd(ep.d); setEh(ep.hh); setEmin(ep.mm)
                setVy(sp.y); setVm(sp.m); setAnchor(null)
              }}
            >
              Last 24h
            </button>
          </div>

          {/* Calendar grid (Mon first) */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map((wd,i)=>(<div key={i} className="py-1 text-neutral-400">{wd}</div>))}
            {Array.from({ length: (startWeekday+6)%7 }).map((_,i)=><div key={`pad-${i}`} className="py-1" />)}
            {Array.from({ length: days }).map((_,i)=>{
              const day = i+1
              const selected = isSelected(vy,vm,day)
              const ranged = inRange(vy,vm,day) && hasRange
              return (
                <button
                  key={day}
                  onClick={()=>clickDay(day)}
                  className={[
                    "rounded-lg py-1.5 text-sm",
                    selected ? "bg-indigo-600 text-white"
                    : ranged ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-200 hover:bg-neutral-800"
                  ].join(' ')}
                >
                  {day}
                </button>
              )
            })}
          </div>

          {/* Time pickers for Start & End */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-[11px] text-neutral-400">Start time</div>
              <div className="flex items-center gap-2">
                <select value={sh} onChange={e=>setSh(Number(e.target.value))}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 focus:ring-2 focus:ring-indigo-600">
                  {Array.from({length:24}).map((_,h)=><option key={h} value={h}>{pad2(h)}</option>)}
                </select>
                <select value={smin} onChange={e=>setSmin(Number(e.target.value))}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 focus:ring-2 focus:ring-indigo-600">
                  {[0,5,10,15,20,25,30,35,40,45,50,55].map(m=><option key={m} value={m}>{pad2(m)}</option>)}
                </select>
            </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-neutral-400">End time</div>
              <div className="flex items-center gap-2">
                <select value={eh} onChange={e=>setEh(Number(e.target.value))}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 focus:ring-2 focus:ring-indigo-600">
                  {Array.from({length:24}).map((_,h)=><option key={h} value={h}>{pad2(h)}</option>)}
                </select>
                <select value={emin} onChange={e=>setEmin(Number(e.target.value))}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 focus:ring-2 focus:ring-indigo-600">
                  {[0,5,10,15,20,25,30,35,40,45,50,55].map(m=><option key={m} value={m}>{pad2(m)}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-3 flex items-center justify-between">
            <button onClick={clear} className="rounded-lg px-2.5 py-1.5 text-xs text-neutral-300 ring-1 ring-neutral-700 hover:bg-neutral-800">
              Clear / Last 24h
            </button>
            <div className="flex gap-2">
              <button onClick={()=>setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:underline">Cancel</button>
              <button
                onClick={apply}
                disabled={cmpDate(sy,sm,sd) > cmpDate(ey,em,ed)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Page ----------
export default function ApiLogPage() {
  const [logs, setLogs] = useState<ApiLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // store as JKT wall time strings
  const [startStr, setStartStr] = useState('')
  const [endStr, setEndStr] = useState('')

  useEffect(()=>{
    const now = new Date()
    setEndStr(jktInputStringFromDate(now))
    setStartStr(jktInputStringFromDate(new Date(now.getTime()-24*3600*1000)))
  },[])

  const dateFromISO = useMemo(()=>jktISOStringFromInput(startStr),[startStr])
  const dateToISO   = useMemo(()=>jktISOStringFromInput(endStr),[endStr])

  const fetchLogs = async () => {
    setLoading(true); setError('')
    try {
      const params: Record<string, any> = {}
      if (dateFromISO) params.date_from = dateFromISO
      if (dateToISO)   params.date_to   = dateToISO
      if (statusFilter !== 'all') params.success = statusFilter === 'success'
      const { data } = await apiClient.get<{ logs: ApiLog[] }>('/client/api-logs', { params })
      setLogs(data.logs || [])
    } catch (e) {
      console.error('Failed to fetch API logs', e)
      setError('Failed to load logs')
    } finally {
      setLoading(false)
    }
  }

  const quick = (hours:number)=>{
    const now = new Date()
    setEndStr(jktInputStringFromDate(now))
    setStartStr(jktInputStringFromDate(new Date(now.getTime()-hours*3600*1000)))
  }

  const badgeForStatus = (code: number) => {
    if (code >= 500) return 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30'
    if (code >= 400) return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
    if (code >= 200) return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
    return 'bg-neutral-500/15 text-neutral-300 ring-1 ring-neutral-500/30'
  }
  const pretty = (s?: string) => { if(!s) return '-'; try{ return JSON.stringify(JSON.parse(s),null,2)}catch{return s} }
  const copy = async (t:string)=>{ try{ await navigator.clipboard.writeText(t) }catch{} }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-neutral-100">API Logs</h1>
        <div className="flex items-center gap-2">
          <button onClick={fetchLogs} className="rounded-xl bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 ring-1 ring-neutral-700 hover:bg-neutral-700">
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 md:grid-cols-5">
        <div className="col-span-3">
          <RangeDateTimePicker
            startValue={startStr}
            endValue={endStr}
            onApply={(s,e)=>{ setStartStr(s); setEndStr(e) }}
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-neutral-400">Status</label>
          <select
            value={statusFilter}
            onChange={(e)=>setStatusFilter(e.target.value as StatusFilter)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:ring-2 focus:ring-indigo-600"
          >
            <option value="all">All</option>
            <option value="success">Success (2xx)</option>
            <option value="failure">Failure (4xx/5xx)</option>
          </select>
        </div>

        <div className="col-span-full flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap gap-2">
            <button onClick={()=>quick(1)} className="rounded-lg px-2.5 py-1 text-xs text-neutral-300 ring-1 ring-neutral-700 hover:bg-neutral-800">Last 1h</button>
            <button onClick={()=>quick(24)} className="rounded-lg px-2.5 py-1 text-xs text-neutral-300 ring-1 ring-neutral-700 hover:bg-neutral-800">Last 24h</button>
            <button onClick={()=>quick(24*7)} className="rounded-lg px-2.5 py-1 text-xs text-neutral-300 ring-1 ring-neutral-700 hover:bg-neutral-800">Last 7d</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchLogs}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-500">
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && <div className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-neutral-800">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm text-neutral-200">
            <thead>
              <tr className="sticky top-0 z-10 bg-neutral-900/80 backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
                <th className="px-4 py-3 font-medium text-neutral-300">Request URL</th>
                <th className="px-4 py-3 font-medium text-neutral-300">Status</th>
                <th className="px-4 py-3 font-medium text-neutral-300">Error</th>
                <th className="px-4 py-3 font-medium text-neutral-300">Response</th>
                <th className="px-4 py-3 font-medium text-neutral-300 whitespace-nowrap">Requested At (WIB)</th>
                <th className="px-4 py-3 font-medium text-neutral-300 whitespace-nowrap">Responded At (WIB)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="animate-pulse">
                    <td className="px-4 py-3"><div className="h-3 w-56 rounded bg-neutral-800" /></td>
                    <td className="px-4 py-3"><div className="h-6 w-16 rounded bg-neutral-800" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-40 rounded bg-neutral-800" /></td>
                    <td className="px-4 py-3"><div className="h-20 w-full rounded bg-neutral-800" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-32 rounded bg-neutral-800" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-32 rounded bg-neutral-800" /></td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-neutral-400">No logs found</td></tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-neutral-900/40">
                    <td className="max-w-[28rem] px-4 py-3 align-top">
                      <div className="flex items-start gap-2">
                        <a href={log.url} target="_blank" rel="noreferrer"
                           className="truncate text-indigo-400 hover:text-indigo-300 hover:underline" title={log.url}>
                          {log.url}
                        </a>
                        <button onClick={()=>navigator.clipboard.writeText(log.url)}
                                className="rounded-lg px-2 py-0.5 text-xs text-neutral-400 ring-1 ring-neutral-700 hover:bg-neutral-800 hover:text-neutral-200">
                          Copy
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${badgeForStatus(log.statusCode)}`}>
                        {log.statusCode}
                      </span>
                    </td>
                    <td className="max-w-[18rem] px-4 py-3 align-top">
                      <span className="block truncate text-neutral-300" title={log.errorMessage || '-'}>
                        {log.errorMessage || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {log.responseBody ? (
                        <details className="group max-w-[34rem]">
                          <summary className="cursor-pointer select-none text-neutral-300 hover:text-neutral-100">
                            View body
                            <span className="ml-2 text-xs text-neutral-500 group-open:hidden">(expand)</span>
                            <span className="ml-2 hidden text-xs text-neutral-500 group-open:inline">(collapse)</span>
                          </summary>
                          <div className="mt-2 max-h-60 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-200">
                            <pre className="whitespace-pre-wrap break-words">{pretty(log.responseBody)}</pre>
                          </div>
                        </details>
                      ) : (<span className="text-neutral-500">-</span>)}
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-neutral-300">{fmtJKT(log.createdAt)}</td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-neutral-300">{log.respondedAt ? fmtJKT(log.respondedAt) : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-neutral-500">
        Query dikirim dalam UTC ISO hasil konversi dari wall time <b>Asia/Jakarta</b>.
      </p>
    </div>
  )
}
