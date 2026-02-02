const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { signAccessToken, signRefreshToken } = require('../utils/tokens');

// Signup user
exports.signup = async (req, res) => {
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.query(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        [name, email, hashedPassword, role],
        (err, result) => {
            if (err) return res.status(400).json({ error: err.message });
            res.status(201).json({ message: 'User registered successfully' });
        }
    );
};

exports.logout = (req, res) => {
    const token = req.cookies.refreshToken;
  
    if (token) {
      db.query(
        'UPDATE users SET refresh_token = NULL, refresh_token_expires = NULL WHERE refresh_token = ?',
        [token]
      );
    }
  
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out successfully' });
  };
  

// Login user

exports.login = (req, res) => {
    const { email, password } = req.body;
  
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, result) => {
      if (err || result.length === 0) {
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
  
      db.query(
        `UPDATE users 
         SET refresh_token = ?, refresh_token_expires = DATE_ADD(NOW(), INTERVAL 7 DAY)
         WHERE id = ?`,
        [refreshToken, user.id]
      );
  
      // 🔥 HTTP-only cookie
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: false, // true in production (HTTPS)
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
    });
  };


// Forgot password (send email)
exports.forgotPassword = (req, res) => {
    const { email } = req.body;
    
    const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const resetToken = token;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL, pass: process.env.EMAIL_PASSWORD }
    });

    const mailOptions = {
        from: process.env.EMAIL,
        to: email,
        subject: 'Password Reset',
        text: `Use this token to reset your password: ${resetToken}`
    };

    db.query(
        'UPDATE users SET reset_token = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE email = ?',
        [resetToken, email],
        (err) => {
            if (err) return res.status(400).json({ error: err.message });

            transporter.sendMail(mailOptions, (err) => {
                if (err) return res.status(500).json({ error: 'Email failed to send' });
                res.json({ message: 'Password reset email sent' });
            });
        }
    );
};

// Reset password
exports.resetPassword = (req, res) => {
    const { token, newPassword } = req.body;
    const hashedPassword = bcrypt.hashSync(newPassword, 10);

    db.query(
        'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
        [token],
        (err, result) => {
            if (err || result.length === 0) return res.status(400).json({ error: 'Invalid or expired token' });

            db.query(
                'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
                [hashedPassword, result[0].id],
                (err) => {
                    if (err) return res.status(500).json({ error: 'Password reset failed' });
                    res.json({ message: 'Password reset successful' });
                }
            );
        }
    );
};

exports.refreshToken = (req, res) => {
    const token = req.cookies.refreshToken;
  
    if (!token) {
      return res.status(401).json({ error: 'No refresh token' });
    }
  
    jwt.verify(token, process.env.JWT_REFRESH_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }
  
      db.query(
        `SELECT * FROM users 
         WHERE id = ? 
         AND refresh_token = ? 
         AND refresh_token_expires > NOW()`,
        [decoded.id, token],
        (err, result) => {
          if (err || result.length === 0) {
            return res.status(401).json({ error: 'Refresh token expired' });
          }
  
          const user = result[0];
  
          const newAccessToken = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '10m' }
          );
  
          res.json({ accessToken: newAccessToken });
        }
      );
    });
  };
  
