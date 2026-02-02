// routes/workOrderRoute.js
const express = require('express');
const router = express.Router();
const workOrderController = require('../controllers/workOrderController');
const controller = require('../controllers/workOrderPdfController')
const authenticateJWT = require('../middleware/authMiddleware');

router.use(authenticateJWT);
// List work orders
router.get('/work-orders', workOrderController.getWorkOrders);

// Get single work order with items
router.get('/work-orders/:id', workOrderController.getWorkOrderById);

// Manually create a WO from a quotation
router.post(
  '/work-orders/from-quotation/:quotationId',
  workOrderController.createFromQuotation
);

router.get('/work-orders/:id/pdf', controller.exportPdf)
router.get('/work-orders/:id/preview', controller.previewHtml)

// Update work order status
router.put('/work-orders/:id/status', workOrderController.updateWorkOrderStatus);

module.exports = router;
