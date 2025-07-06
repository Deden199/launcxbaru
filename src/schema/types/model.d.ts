type Transaction = {
  merchantName: string;
  price: string;
  buyer?: string;
}

type TransactionRequest = {
  custIdMerchant: string;
  partnerReferenceNo: string;
  amount: Amount;
  amountDetail: AmountDetail;
  payMethod: string;
  commissionPercentage: string;
  expireInSecond: string;
  feeType: string;
  apiSource: string;
  additionalInfo: string;
};

type AdditionalInfo = {
  email: string;
  notes: string;
  description: string;
  phoneNumber: string;
  fullname: string;
}

type Amount = {
  value: string;
  currency: string;
}

type AmountDetail = {
  basicAmount : Amount;
  shippingAmount : Amount;

}

type AuthCredential = {
  clientId: string;
  signedJwt: string;
}
