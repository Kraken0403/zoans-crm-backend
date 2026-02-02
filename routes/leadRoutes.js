const express = require('express');
const leadController = require('../controllers/leadController');
const authenticateJWT = require('../middleware/authMiddleware'); // Import the middleware for protected routes
const router = express.Router();

// Public routes for creating leads and retrieving them
router.post('/leads', leadController.createLead);
router.get('/leads', leadController.getAllLeads);
router.get('/leads/:id', leadController.getLeadById);

// Protected routes for updating and deleting leads
router.put('/leads/:id', authenticateJWT, leadController.updateLead);
router.delete('/leads/:id', authenticateJWT, leadController.deleteLead);

module.exports = router;
