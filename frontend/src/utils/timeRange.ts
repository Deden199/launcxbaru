import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * Returns ISO strings for the start and end of a specific hour in Asia/Jakarta.
 * Using this helper centralizes the timezone handling for hourly ranges.
 */
export function hourRange(date: Date, hour: number) {
  // Interpret the provided date in Jakarta time and snap to the requested hour
  const start = dayjs(date).tz('Asia/Jakarta', true).hour(hour).startOf('hour')
  // The end of the range is exactly one hour later
  const end = start.add(1, 'hour')
  return { from: start.toDate().toISOString(), to: end.toDate().toISOString() }
}
