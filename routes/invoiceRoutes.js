const express = require('express')
const router = express.Router()
const {
   downloadInvoicePdf,
   previewInvoiceHtml,
 } = require('../controllers/invoicePdfController')

const {
  createInvoice,
  createInvoiceFromWorkOrder,
  getInvoices,
  getInvoiceById,
  updateInvoiceStatus,
} = require('../controllers/invoiceController')

/* ---------------------------------------------------------
   CREATE INVOICE (Manual / Frontend Order)
   POST /api/invoices
--------------------------------------------------------- */
router.post('/invoices', createInvoice)

/* ---------------------------------------------------------
   CREATE FROM WORK ORDER
   POST /api/invoices/from-workorder/:workOrderId
--------------------------------------------------------- */
router.post(
  '/invoices/from-workorder/:workOrderId',
  createInvoiceFromWorkOrder
)

/* ---------------------------------------------------------
   LIST INVOICES
   GET /api/invoices
--------------------------------------------------------- */
router.get('/invoices', getInvoices)

/* ---------------------------------------------------------
   GET INVOICE BY ID
   GET /api/invoices/:id
--------------------------------------------------------- */
router.get('/invoices/:id', getInvoiceById)

/* ---------------------------------------------------------
   UPDATE INVOICE STATUS
   PUT /api/invoices/:id/status
--------------------------------------------------------- */
router.put('/invoices/:id/status', updateInvoiceStatus)

router.get('/invoices/:id/pdf', downloadInvoicePdf)

/* ---------------------------------------------------------
   PREVIEW INVOICE HTML
--------------------------------------------------------- */
router.get('/invoices/:id/preview', previewInvoiceHtml)

module.exports = router
