// routes/public.js
const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const publicOrderController = require('../controllers/publicOrderController');

// Public products
router.get('/products', productController.getPublicProducts);
router.get('/products/:id', productController.getPublicProductById);

// ✅ ADD THIS
router.get('/categories', productController.getCategories);

router.post('/order', publicOrderController.createOrder);

module.exports = router;
