const express = require("express");
const router = express.Router();
const authenticateJWT = require('../middleware/authMiddleware');

router.use(authenticateJWT);
const {
  getSettings,
  updateSettings
} = require("../controllers/settingsController");

const upload = require("../middleware/upload");

// MOUNT THE ROUTES AS /settings
router.get("/settings", getSettings);
router.put("/settings", upload.single("company_logo"), updateSettings);

module.exports = router;
