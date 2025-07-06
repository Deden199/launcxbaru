import { body, param, validationResult } from 'express-validator';

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// Validation rules for initiating a payment
const initiatePaymentValidation = [
    body('amount')
        .isInt({ gt: 0 })
        .withMessage('Amount must be a numeric value'),

    body('merchant_id')
        .isAlphanumeric()
        .withMessage('Merchant ID must only contain letters and numbers'),

    body('currency')
        .isLength({ min: 3, max: 3 })
        .withMessage('Currency must be a 3-letter code'),

    body('payer_id')
        .optional()
        .isAlphanumeric()
        .withMessage('Payer ID must only contain letters and numbers'),

    body('payment_method')
        .isIn(['qris', 'virtual_account'])
        .withMessage('Invalid payment method'),

    body('description')
        .optional()
        .isAlphanumeric()
        .withMessage('Description must only contain letters and numbers '),

    body('request_id')
        .isUUID()
        .withMessage('request_id key must only contain letters and numbers '),
];

// Validation for Initiate Disbursement Request
const initiateDisbursementValidation = [
    body('amount')
        .isInt({ gt: 0 })
        .withMessage('Amount must be a positive integer.'),

    body('account_no')
        .isString()
        .isLength({ min: 1 })
        .withMessage('Recipient account is required and must be a valid string.'),

    body('bank_code')
        .isString()
        .matches(/^\d{3}$/)
        .withMessage('Bank code must be a three-digit numeric code.'),

    body('currency')
        .isString()
        .isLength({ min: 3, max: 3 })
        .withMessage('Currency must be a 3-character ISO currency code.'),

    body('description')
        .optional() // Makes the description optional
        .isString()
        .withMessage('Description must be a valid string if provided.'),

    body('request_id')
        .isUUID()
        .withMessage('request_id key must only contain letters and numbers '),
];

// Validation rules for checking payment status
const getStatusValidation = [
    param('payment_id')
        .isAlphanumeric()
        .withMessage('Payment ID must be alphanumeric'),
];

// Validation for Get Disbursement Status Request
const getDisbursementStatusValidation = [
    param('disbursement_id')
        .isString()
        .isLength({ min: 1 })
        .withMessage('Disbursement ID is required and must be a valid string.'),
];

// Validation for Check Account Request
const checkAccountValidation = [
    param('bank_code')
        .isAlphanumeric()
        .matches(/^\d{3}$/)
        .withMessage('Bank code must be a three-digit numeric code.'),

    param('account_number')
        .isAlphanumeric()
        .isLength({ min: 1 })
        .withMessage('Account number is required and must be a valid number.'),
];




const validation = {
    handleValidationErrors,
    initiatePaymentValidation,
    getStatusValidation,
    initiateDisbursementValidation,
    getDisbursementStatusValidation,
    checkAccountValidation
};

export default validation;