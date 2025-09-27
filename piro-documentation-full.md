# PIRO + GENESIS Unified API Documentation

This document merges **Genesis Project API Documentation (v0.0.2, June 2025)** and **Piro.id API Documentation (v1.0.1, September 2025)** into a single reference.

---

## Environment Configuration

Set the following environment variables when deploying Genesis support so the service can authenticate without falling back to Piro credentials:

- `GENESIS_CLIENT_ID`
- `GENESIS_CLIENT_SECRET`

These values are provided alongside the Genesis secret and callback configuration for each environment.

---

# 1. Document Versions & History

## Genesis Project
- **Version 0.0.1** (13 Dec 2024) – Initial docs
- **Version 0.0.2** (25 June 2025) – Added Base URL updates

## Piro.id
- **Version 1.0.1** (15 Sept 2025) – Initial release

---

# 2. Audience
Both APIs are intended for software developers integrating B2B applications.  
Requires knowledge of:
- RESTful Web Services (WebAPI)
- HTTP/1.1
- JSON Data Serialization

---

# 3. Genesis Project API

## 3.1 New Merchant Registration

**Base URL**:  
`https://us-central1-piye-95c18.cloudfunctions.net`  
`https://us-central1-genesis-994eb.cloudfunctions.net`  

**Endpoint**:  
`/user2gen/v1/user-register-create`  

**Method**: `POST`  

### Request Headers
```json
{
  "Content-Type": "application/json",
  "Accept": "application/json",
  "x-signature": "MD5(email+username+password+callbackClient+abc)"
}
```

**Example Signature**:  
MD5("susan@linux.idsusanxABChttps://genesis.id/callbackabc")

### Request Body
```json
{
  "id": "x",
  "payload": {
    "UID": "x",
    "email": "susan@linux.id",
    "mobile": "08170060097",
    "username": "susan",
    "password": "xABC",
    "callbackClient": "https://genesis.id/callback",
    "banksAccount": {
      "bankName": "PT. BPD BALI",
      "accountNumber": "1122233",
      "accountName": "susan",
      "bankBICode": "ABALIDBS"
    }
  },
  "dto": "x",
  "collection": "x",
  "idAdmin": "x",
  "timestamp": 0,
  "signature": "x"
}
```

### Response
**201 OK**
```json
{
  "data": {
    "UID": "eb15fa7d-826d-46b6-a8e8-4c7fe9907b55",
    "username": "susan",
    "password": "T#Vh2LP3MT",
    "callbackClient": "https://genesis.id/callback",
    "clientId": "eb15fa7d-826d-46b6-a8e8-4c7fe9907b55",
    "clientSecret": "7b8f9cea14c4256d3c54911d1aa00165"
  },
  "error": null
}
```

**500 ERROR**
```json
{ "data": null, "error": "POST server Signature not valid" }
```

---

## 3.2 QRIS SNAP

### Generate QRIS
**Endpoint**: `/qrissnap2gen/v1/qr-mpm-generate-order`  
**Headers**:
```json
{
  "Content-Type": "application/json",
  "Accept": "application/json",
  "client_id": "<client_id>",
  "x-signature": "MD5(client_id+value+orderId+clientSecret)"
}
```

**Request Body**
```json
{
  "value": "10000.00",
  "orderId": "171836274993"
}
```

**Response 201 OK**
```json
{
  "qrisData": "000201010212...",
  "orderId": "1718366184993",
  "TX": "gsdbJX1K8ncXuLfxaFeg",
  "clientId": "b654328b-2eeb-4c1f-843d-dae0392c9127",
  "error": null
}
```

**500 ERROR**
```json
{ "data": null, "error": "something went wrong" }
```

### Callback
**Request Headers**
```json
{ "Content-Type": "application/json" }
```

**Request Body Example**
```json
{
  "TX": "gsdbJX1K8ncXuLfxaFeg",
  "amountSend": 10000,
  "callbackClient": "https://genesis.id/callback",
  "charges": 0,
  "clientId": "b654328b-2eeb-4c1f-843d-dae0392c9127",
  "id": "gsdbJX1K8ncXuLfxaFeg-Q44JHSaoYTk8i3Z0Dpi1",
  "orderId": "1718366184993",
  "paymentStatus": "Success",
  "attachment": {
    "responseCode": "2005100",
    "responseMessage": "Request has been processed successfully",
    "serviceCode": "51",
    "transactionStatusDesc": "Success",
    "latestTransactionStatus": "00",
    "paidTime": "2024-07-12T14:50:23+07:00",
    "amount": { "value": "10000.00", "currency": "IDR" },
    "additionalInfo": {
      "issuerID": "93600918",
      "posID": "A01",
      "retrievalReferenceNo": "KA4U86KAZSHHK",
      "nettAmount": "0.00",
      "totalRefund": "0.00",
      "paymentReferenceNo": "1280224071206361178281880489760",
      "nmid": "123344"
    }
  },
  "timestamp": 1718366282495
}
```

### Query
**Endpoint**: `/qrissnap2gen/v1/qr-mpm-query`  
**Request Body**
```json
{ "orderId": "1718366184993" }
```

**Response 200 OK**
```json
{
  "data": {
    "responseCode": "2005100",
    "responseMessage": "Request has been processed successfully",
    "transactionStatusDesc": "Success",
    "latestTransactionStatus": "00",
    "paidTime": "2024-06-14T18:57:58+07:00",
    "amount": { "value": "10000.00", "currency": "IDR" }
  },
  "orderId": "1718366184993",
  "TX": "gsdbJX1K8ncXuLfxaFeg",
  "clientId": "b654328b-2eeb-4c1f-843d-dae0392c9127",
  "nmid": "123344",
  "error": null
}
```

**Response Un-paid**
```json
{
  "code": 404,
  "message": "Transaction Not Found",
  "details": { "internalCode": "4045101", "description": "Request failed with status code 404" }
}
```

**Order Not Found**
```json
{ "data": [], "error": "orderId not found" }
```

---

# 4. Piro.id API

## 4.1 New Merchant Registration

**Base URL**: `https://payment.piro.id`  
**Endpoint**: `/payment-qris/v1/user-register`  
**Method**: `POST`  

### Authentication
- Basic Authentication
- Username = `piro-<millis>` (UTC+7 timestamp daily)
- Password = `<millis>` (UTC+7 timestamp daily)

### Request Headers
```json
{
  "Content-Type": "application/json",
  "Accept": "application/json",
  "Authorization": "Basic <username:password>",
  "x-signature": "MD5(email+username+password+callbackClient+millis)"
}
```

### Request Body
(Same structure as Genesis, includes `banksAccount` with `bankBICode`)

### Response
Same as Genesis, includes `clientId`, `clientSecret`.

---

## 4.2 Interbank-RTOL Transfer

**Base URL**: `https://us-central1-doc-basic.cloudfunctions.net`  
**Endpoint**: `/noburtol2gen/v1/transfer-interbank`  
**Method**: `POST`  

### Headers
```json
{
  "x-signature": "MD5(clientId+deviceId+lat+long+value+beneficiaryAccountNo+clientSecret)",
  "client_id": "b654328b-2eeb-4k2f-843d-2ae0392c9127",
  "device_id": "web",
  "latitude": "-6.175110",
  "longitude": "106.865036",
  "Content-Type": "application/json"
}
```

### Request Body
```json
{
  "beneficiaryAccountNo": "4383310125",
  "value": "25000.00",
  "beneficiaryBankCode": "014"
}
```

### Response 200 OK
```json
{
  "responseCode": "2001800",
  "responseMessage": "Request has been processed successfully",
  "referenceNo": "000000415903",
  "partnerReferenceNo": "171750625724980",
  "amount": { "value": "25000.00", "currency": "IDR" },
  "beneficiaryAccountNo": "4383310125",
  "beneficiaryBankCode": "014",
  "ID": "4QfsNPA3ISvRw34kkx8S",
  "clientId": "b654328b-2eeb-4k2f-843d-2ae0392c9127",
  "error": null
}
```

### Response 500 Error
```json
{ "data": null, "error": "something went wrong" }
```

---

## 4.3 Inquiry RTOL

**Endpoint**: `/pironobubifast2gen/v1/inquiry-transfer-interbank`  
**Request Body**
```json
{ "beneficiaryAccountNo": "4330310125", "beneficiaryBankCode": "014" }
```

**Response 201 OK**
```json
{
  "responseCode": "2001600",
  "responseMessage": "Request has been processed successfully",
  "beneficiaryAccountName": "BUDI MARTANTO",
  "beneficiaryAccountNo": "4330310125",
  "beneficiaryBankCode": "014",
  "currency": "IDR",
  "error": null
}
```

**Response 500 Error**
```json
{
  "data": { "log": "inquiry error", "transactionDate": "2024-07-07T10:55:52+07:00" },
  "error": {
    "message": "Request failed with status code 500",
    "status": 500,
    "data": { "responseCode": "5001601", "responseMessage": "Internal Server Error" }
  }
}
```

---

## 4.4 Disbursement Balance Inquiry

**Endpoint**: `/pirouserone2gen/v1/users-by-dash`  
**Method**: `GET`  

### Headers
```json
{
  "x-signature": "MD5(clientId+deviceId+lat+long+clientSecret)",
  "client_id": "b654328b-2eeb-4c1f-843d-2ae0392c9127",
  "device_id": "web",
  "latitude": "-6.175110",
  "longitude": "106.865036"
}
```

### Response
```json
{
  "client_id": "b654328b-2eeb-4c1f-843d-2ae0392c9127",
  "current_account": {
    "settled": { "balance": 0, "count": 0, "credit": 0, "debit": 0, "status": "success at 2025-06-01T16:45:57.109Z" },
    "unsettled": { "balance": 0, "count": 0, "credit": 0, "debit": 0, "status": "" }
  },
  "bankRef": {},
  "error": null
}
```

---

# 5. Appendix

- **Signature Mechanism**: Both APIs use MD5 for signing, with different formulas.
- **Auth**:
  - Genesis: static with `abc` constant
  - Piro: dynamic with Basic Auth (timestamp-based)
- **Functional Scope**:
  - Genesis: Merchant registration + QRIS SNAP (generate, callback, query)
  - Piro: Merchant registration + Interbank transfers (RTOL) + Disbursement inquiry
