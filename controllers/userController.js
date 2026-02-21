
// Fetch all users
const db = require('../config/db');

/* --------------------------------------------------
   GET ALL USERS
-------------------------------------------------- */
exports.getAllUsers = async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT * FROM users`
    );

    return res.status(200).json(users);

  } catch (err) {
    console.error('getAllUsers error:', err);
    return res.status(500).json({
      error: 'Failed to fetch users',
      details: err.message
    });
  }
};


/* --------------------------------------------------
   GET USER BY ID
-------------------------------------------------- */
exports.getUserById = async (req, res) => {
  try {
    const userId = req.params.id;

    const [rows] = await db.query(
      `SELECT * FROM users WHERE id = ?`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    return res.status(200).json(rows[0]);

  } catch (err) {
    console.error('getUserById error:', err);
    return res.status(500).json({
      error: 'Failed to fetch user',
      details: err.message
    });
  }
};


/* --------------------------------------------------
   UPDATE USER
-------------------------------------------------- */
exports.updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, role } = req.body;

    const [result] = await db.query(
      `
      UPDATE users
      SET name = ?, email = ?, role = ?
      WHERE id = ?
      `,
      [name, email, role, userId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    return res.status(200).json({
      message: 'User updated successfully',
      userId
    });

  } catch (err) {
    console.error('updateUser error:', err);
    return res.status(500).json({
      error: 'Failed to update user',
      details: err.message
    });
  }
};


/* --------------------------------------------------
   DELETE USER
-------------------------------------------------- */
exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    const [result] = await db.query(
      `DELETE FROM users WHERE id = ?`,
      [userId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    return res.status(200).json({
      message: 'User deleted successfully',
      userId
    });

  } catch (err) {
    console.error('deleteUser error:', err);
    return res.status(500).json({
      error: 'Failed to delete user',
      details: err.message
    });
  }
};
