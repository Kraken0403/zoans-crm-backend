const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { signAccessToken, signRefreshToken } = require('../utils/tokens');

/* =====================================================
   SIGNUP
===================================================== */
exports.signup = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      `INSERT INTO users (name, email, password, role) 
       VALUES (?, ?, ?, ?)`,
      [name, email, hashedPassword, role]
    );

    res.status(201).json({ message: 'User registered successfully' });

  } catch (err) {
    console.error('SIGNUP ERROR:', err);
    res.status(400).json({ error: err.message });
  }
};


/* =====================================================
   LOGOUT
===================================================== */
exports.logout = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;

    if (token) {
      await db.query(
        `UPDATE users 
         SET refresh_token = NULL, 
             refresh_token_expires = NULL 
         WHERE refresh_token = ?`,
        [token]
      );
    }

    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out successfully' });

  } catch (err) {
    console.error('LOGOUT ERROR:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
};


/* =====================================================
   LOGIN
===================================================== */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const [result] = await db.query(
      `SELECT * FROM users WHERE email = ?`,
      [email]
    );

    if (!result.length) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const accessToken = signAccessToken({
      id: user.id,
      role: user.role,
    });

    const refreshToken = signRefreshToken({
      id: user.id,
    });

    await db.query(
      `UPDATE users 
       SET refresh_token = ?, 
           refresh_token_expires = DATE_ADD(NOW(), INTERVAL 7 DAY)
       WHERE id = ?`,
      [refreshToken, user.id]
    );

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: false, // TRUE in production (HTTPS)
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });

  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({ error: 'Login failed' });
  }
};


/* =====================================================
   FORGOT PASSWORD
===================================================== */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const resetToken = jwt.sign(
      { email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    await db.query(
      `UPDATE users 
       SET reset_token = ?, 
           reset_token_expires = DATE_ADD(NOW(), INTERVAL 15 MINUTE)
       WHERE email = ?`,
      [resetToken, email]
    );

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL,
      to: email,
      subject: 'Password Reset',
      text: `Use this token to reset your password: ${resetToken}`
    });

    res.json({ message: 'Password reset email sent' });

  } catch (err) {
    console.error('FORGOT PASSWORD ERROR:', err);
    res.status(500).json({ error: 'Email failed to send' });
  }
};


/* =====================================================
   RESET PASSWORD
===================================================== */
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const [result] = await db.query(
      `SELECT * FROM users 
       WHERE reset_token = ? 
       AND reset_token_expires > NOW()`,
      [token]
    );

    if (!result.length) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      `UPDATE users 
       SET password = ?, 
           reset_token = NULL, 
           reset_token_expires = NULL 
       WHERE id = ?`,
      [hashedPassword, result[0].id]
    );

    res.json({ message: 'Password reset successful' });

  } catch (err) {
    console.error('RESET PASSWORD ERROR:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
};


/* =====================================================
   REFRESH TOKEN
===================================================== */
exports.refreshToken = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;

    if (!token) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET
    );

    const [result] = await db.query(
      `SELECT * FROM users 
       WHERE id = ? 
       AND refresh_token = ? 
       AND refresh_token_expires > NOW()`,
      [decoded.id, token]
    );

    if (!result.length) {
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    const user = result[0];

    const newAccessToken = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    res.json({ accessToken: newAccessToken });

  } catch (err) {
    console.error('REFRESH TOKEN ERROR:', err);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};
