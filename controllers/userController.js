const db = require('../config/db');

// Fetch all users
exports.getAllUsers = (req, res) => {
    const usersQuery = 'SELECT * FROM users';

    db.query(usersQuery, (err, users) => {
        if (err) {
            return res.status(500).json({
                error: 'Failed to fetch users',
                details: err.message
            });
        }

        res.status(200).json(users);
    });
};

// Fetch a user by ID
exports.getUserById = (req, res) => {
    const userId = req.params.id;
    const userQuery = 'SELECT * FROM users WHERE id = ?';

    db.query(userQuery, [userId], (err, user) => {
        if (err) {
            return res.status(500).json({
                error: 'Failed to fetch user',
                details: err.message
            });
        }

        if (user.length === 0) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        res.status(200).json(user[0]);
    });
};

// Update a user by ID
exports.updateUser = (req, res) => {
    const userId = req.params.id;
    const { name, email, role } = req.body; // Assuming the user has these fields

    const updateQuery = 'UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?';

    db.query(updateQuery, [name, email, role, userId], (err, result) => {
        if (err) {
            return res.status(500).json({
                error: 'Failed to update user',
                details: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        res.status(200).json({
            message: 'User updated successfully',
            userId: userId
        });
    });
};

// Delete a user by ID
exports.deleteUser = (req, res) => {
    const userId = req.params.id;

    const deleteQuery = 'DELETE FROM users WHERE id = ?';

    db.query(deleteQuery, [userId], (err, result) => {
        if (err) {
            return res.status(500).json({
                error: 'Failed to delete user',
                details: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        res.status(200).json({
            message: 'User deleted successfully',
            userId: userId
        });
    });
};
