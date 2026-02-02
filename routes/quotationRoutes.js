// routes/quotationRoutes.js
const express = require('express');
const router = express.Router();
const quotationController = require('../controllers/quotationController');
const quotationPdfController = require('../controllers/quotationPdfController');
const authenticateJWT = require('../middleware/authMiddleware');

router.use(authenticateJWT);
// Retrieve all quotations
console.log('✅ quotationRoutes loaded');

router.get('/quotations', quotationController.getQuotations);

// Retrieve a specific quotation (including its items)
router.get('/quotations/:id', quotationController.getQuotationById);

// Create a new quotation
router.post('/quotations', quotationController.createQuotation);

// Update a quotation header (updates do not include items by this endpoint)
router.put('/quotations/:id', quotationController.updateQuotation);

// 🔹 NEW: Update quotation items (and recalc total)
router.put('/quotations/:id/items', quotationController.updateQuotationItems);

// Delete a quotation and its associated items
router.delete('/quotations/:id', quotationController.deleteQuotation);

router.get('/quotations/:id/pdf', quotationPdfController.exportPdf)

router.get('/quotations/:id/pdf-preview', quotationPdfController.previewHtml)

router.put('/quotations/:id/status', quotationController.updateQuotationStatus);

module.exports = router;
