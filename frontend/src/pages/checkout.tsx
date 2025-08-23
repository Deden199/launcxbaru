"use client";

import { useMemo, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, Lock, ShieldCheck, Globe, ArrowRight } from "lucide-react";
import { normalizeToBase64Spki, encryptHybrid } from "@/utils/hybrid-encryption";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

type CaptureMethod = "automatic" | "manual";
type ThreeDsMethod = "CHALLENGE" | "AUTO";

type Brand =
  | "visa"
  | "mastercard"
  | "amex"
  | "jcb"
  | "discover"
  | "unionpay"
  | "unknown";

function onlyDigits(v: string) {
  return (v || "").replace(/\D+/g, "");
}

function formatCardNumber(v: string) {
  const digits = onlyDigits(v).slice(0, 19);
  const parts: string[] = [];
  let i = 0;
  while (i < digits.length) {
    const size = i >= 16 ? 3 : 4; // 4-4-4-4-3 (max 19)
    parts.push(digits.slice(i, i + size));
    i += size;
  }
  return parts.join(" ");
}

function detectBrand(pan: string): Brand {
  const d = onlyDigits(pan);
  if (/^4\d{6,}$/.test(d)) return "visa";
  if (/^(5[1-5]|2[2-7])\d{4,}$/.test(d)) return "mastercard";
  if (/^3[47]\d{5,}$/.test(d)) return "amex";
  if (/^(35)\d{6,}$/.test(d)) return "jcb";
  if (/^6(?:011|5)/.test(d)) return "discover";
  if (/^(62)/.test(d)) return "unionpay";
  return "unknown";
}

function brandBadge(brand: Brand) {
  const map: Record<Brand, string> = {
    visa: "VISA",
    mastercard: "Mastercard",
    amex: "Amex",
    jcb: "JCB",
    discover: "Discover",
    unionpay: "UnionPay",
    unknown: "Card",
  };
  return map[brand];
}

function brandClass(brand: Brand) {
  switch (brand) {
    case "visa":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
    case "mastercard":
      return "bg-orange-50 text-orange-700 ring-1 ring-orange-200";
    case "amex":
      return "bg-teal-50 text-teal-700 ring-1 ring-teal-200";
    case "jcb":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
    case "discover":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
    case "unionpay":
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
    default:
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  }
}

function formatExpiry(v: string) {
  const d = onlyDigits(v).slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

function formatAmountIDR(v: string) {
  const n = Number(onlyDigits(v));
  if (!n) return "";
  return new Intl.NumberFormat("id-ID").format(n);
}

function extractPaymentUrl(d: any): string | null {
  if (!d || typeof d !== "object") return null;
  const cands = [
    d.paymentUrl,
    d?.data?.paymentUrl,
    d?.result?.paymentUrl,
    d?.paymentSession?.paymentUrl,
    d.redirectUrl,
    d?.data?.redirectUrl,
    d?.nextAction?.url,
    d?.next_action?.url,
    d?.actions?.threeDs?.url,
    d?.payment?.paymentUrl,
    d?.links?.redirect,
  ];
  for (const v of cands) {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

export default function CheckoutPage() {
  const [cardNumber, setCardNumber] = useState("");
  const [nameOnCard, setNameOnCard] = useState("");
  const [expiry, setExpiry] = useState(""); // MM/YY
  const [cvv, setCvv] = useState("");
  const [amount, setAmount] = useState("");
  const [buyerId, setBuyerId] = useState("");

  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>("automatic");
  const [threeDsMethod, setThreeDsMethod] = useState<ThreeDsMethod>("CHALLENGE");

  const [sessionId, setSessionId] = useState("");
  const [encryptionKey, setEncryptionKey] = useState(""); // base64 SPKI/PEM

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const brand = useMemo(() => detectBrand(cardNumber), [cardNumber]);

  const validate = () => {
    const panOk = /^\d{12,19}$/.test(onlyDigits(cardNumber));
    const expOk = /^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry);
    const cvvLen = brand === "amex" ? 4 : 3;
    const cvvOk = new RegExp(`^\\d{${cvvLen},4}$`).test(cvv);
    const amtOk = Number(onlyDigits(amount)) > 0;
    if (!buyerId) return "Buyer ID is required";
    if (!panOk) return "Invalid card number";
    if (!expOk) return "Invalid expiry (MM/YY)";
    if (!cvvOk) return `Invalid CVV (${cvvLen} digits)`;
    if (!amtOk) return "Amount must be > 0";
    return "";
  };

  const ensureSession = async () => {
    const res = await axios.post(`${API_URL}/payments/session`, {
      amount: { value: Number(onlyDigits(amount)), currency: "IDR" },
      buyerId,
    });

    const { id, encryptionKey } = res.data || {};
    if (!id || !encryptionKey) throw new Error("Missing session id / encryptionKey");
    setSessionId(id);
    setEncryptionKey(encryptionKey);
    return { id, encryptionKey };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    setBusy(true);
    try {
      const { id, encryptionKey: ek } = await ensureSession();
      const base64Spki = normalizeToBase64Spki(ek);
      const [mm, yy] = expiry.split("/");
      const payload = {
        card: {
          number: onlyDigits(cardNumber),
          expiryMonth: (mm || "").padStart(2, "0"),
          expiryYear: yy || "",
          cvc: cvv,
          nameOnCard,
        },
        deviceInformations: {
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          country: "ID",
        },
        metadata: {},
      };
      const encryptedCard = await encryptHybrid(JSON.stringify(payload), base64Spki);
      const res = await axios.post(`${API_URL}/payments/${id}/confirm`, {
        encryptedCard,
        paymentMethodOptions: { card: { captureMethod, threeDsMethod } },
      });
      const data = res.data || {};
      const url = extractPaymentUrl(data);
      console.log("[Confirm response]", data);
      if (url) {
        window.location.replace(url);
      } else {
        setError("Provider tidak mengembalikan paymentUrl / 3DS URL. Cek console untuk payload lengkap.");
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const providerRaw = err?.response?.data;
      const msg =
        providerRaw?.provider?.message ||
        providerRaw?.error ||
        providerRaw?.message ||
        err?.message ||
        "Payment failed";
      if (
        status === 409 ||
        /cannot be confirmed/i.test(String(msg)) ||
        /not allowed to confirm/i.test(JSON.stringify(providerRaw || {}))
      ) {
        setSessionId("");
        setEncryptionKey("");
        setError("Session tidak bisa dikonfirmasi. Silakan klik Pay lagi untuk membuat sesi baru.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const maskedAmount = useMemo(() => formatAmountIDR(amount), [amount]);

  return (
    <div className="min-h-dvh w-full bg-[linear-gradient(180deg,_#eef2ff_0%,_#ffffff_50%,_#f0f9ff_100%)] dark:bg-[linear-gradient(180deg,_#020617_0%,_#0b1220_100%)]">
      {/* Top ribbon */}
      <div className="w-full bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-500 text-white">
        <div className="mx-auto max-w-5xl px-4 py-2 text-xs sm:text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Encrypted card entry • 3‑D Secure • Real-time session
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
        <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:mb-8 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Secure Card Checkout</h1>
            <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">
              Pay safely with strong encryption and 3‑D Secure verification.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
            <ShieldCheck className="h-4 w-4" />
            <span>Data encrypted end‑to‑end</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Form Card */}
          <Card className="col-span-1 border-slate-200/80 shadow-sm lg:col-span-3">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-5 w-5 text-indigo-600" /> Card details
              </CardTitle>
              <CardDescription className="text-[13px]">Enter your card and billing info</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <Separator className="mb-5" />

              {error ? (
                <Alert variant="destructive" className="mb-5 text-[13px]">
                  <AlertTitle className="text-sm">Payment error</AlertTitle>
                  <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
                </Alert>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="buyerId" className="text-[12px]">User ID</Label>
                    <Input
                      id="buyerId"
                      value={buyerId}
                      onChange={(e) => setBuyerId(e.target.value)}
                      placeholder="user_123"
                      autoComplete="off"
                      className="h-10 text-[14px]"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="cardNumber" className="text-[12px]">Card Number</Label>
                    <Badge className={`font-medium ${brandClass(brand)} text-[11px]`}>{brandBadge(brand)}</Badge>
                  </div>
                  <Input
                    id="cardNumber"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    placeholder="1234 5678 9012 3456"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                    className="h-10 text-[14px]"
                    required
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="nameOnCard" className="text-[12px]">Name on Card</Label>
                    <Input
                      id="nameOnCard"
                      autoComplete="cc-name"
                      placeholder="JOHN DOE"
                      value={nameOnCard}
                      onChange={(e) => setNameOnCard(e.target.value)}
                      className="h-10 text-[14px]"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amount" className="text-[12px]">Amount (IDR)</Label>
                    <Input
                      id="amount"
                      inputMode="numeric"
                      placeholder="100.000"
                      value={maskedAmount}
                      onChange={(e) => setAmount(e.target.value)}
                      onBlur={(e) => setAmount(formatAmountIDR(e.target.value))}
                      className="h-10 text-[14px]"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="expiry" className="text-[12px]">Expiry</Label>
                    <Input
                      id="expiry"
                      inputMode="numeric"
                      autoComplete="cc-exp"
                      placeholder="MM/YY"
                      value={expiry}
                      onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                      className="h-10 text-[14px]"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cvv" className="text-[12px]">CVV</Label>
                    <div className="relative">
                      <Input
                        id="cvv"
                        type="password"
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        placeholder={brand === "amex" ? "4 digits" : "3 digits"}
                        value={cvv}
                        onChange={(e) => setCvv(onlyDigits(e.target.value).slice(0, 4))}
                        className="h-10 pr-9 text-[14px]"
                        required
                      />
                      <Lock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[12px]">3DS Method</Label>
                    <Select value={threeDsMethod} onValueChange={(v: ThreeDsMethod) => setThreeDsMethod(v)}>
                      <SelectTrigger className="h-10 text-[14px]">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CHALLENGE">Challenge</SelectItem>
                        <SelectItem value="AUTO">Auto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-[12px]">Capture Method</Label>
                    <Select value={captureMethod} onValueChange={(v: CaptureMethod) => setCaptureMethod(v)}>
                      <SelectTrigger className="h-10 text-[14px]">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="automatic">Automatic</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-end justify-end">
                    <motion.div initial={{ scale: 0.98, opacity: 0.9 }} animate={{ scale: 1, opacity: 1 }}>
                      <Button
                        type="submit"
                        className="h-11 px-5 bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-500 hover:to-blue-500"
                        disabled={busy}
                      >
                        {busy ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing
                          </>
                        ) : (
                          <>
                            Pay <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </motion.div>
                  </div>
                </div>

                {/* Invisible but useful for debug */}
                <div className="text-[12px] text-slate-500">
                  {sessionId ? (
                    <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                      <div>
                        Session: <span className="font-mono">{sessionId}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Globe className="h-3 w-3" /> 3DS: {threeDsMethod} • Capture: {captureMethod}
                      </div>
                    </div>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Summary / Security */}
          <Card className="col-span-1 border-slate-200/80 shadow-sm lg:col-span-2">
            <CardHeader className="pb-0">
              <CardTitle className="text-base">Order Summary</CardTitle>
              <CardDescription className="text-[13px]">Preview before you pay</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <Separator className="mb-5" />
              <div className="space-y-4">
                <div className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-slate-600">Amount</span>
                    <span className="font-semibold text-slate-900">Rp {maskedAmount || "0"}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[13px]">
                    <span className="text-slate-600">Buyer</span>
                    <span className="font-medium">{buyerId || "—"}</span>
                  </div>
                </div>

                <div className="rounded-2xl bg-gradient-to-br from-sky-50 to-indigo-50 p-4 text-[12px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
                  <div className="mb-1 flex items-center gap-2 font-medium text-slate-900">
                    <ShieldCheck className="h-4 w-4 text-indigo-600" /> Security & Privacy
                  </div>
                  <ul className="list-disc pl-5">
                    <li>Card details are encrypted using hybrid public-key encryption.</li>
                    <li>3‑D Secure may challenge you for extra verification.</li>
                    <li>We never store your full card number or CVV.</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// @ts-ignore
(CheckoutPage as any).disableLayout = true;