const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

const authenticateJWT = require('../middleware/authMiddleware');

router.use(authenticateJWT);

router.get('/users', userController.getAllUsers)
router.get('/users/:id', userController.getUserById);
// Update a user by ID
router.put('/users/:id', userController.updateUser);

// Delete a user by ID
router.delete('/users/:id', userController.deleteUser);

module.exports = router;