const db = require('../config/db'); // MySQL pool instance

/* ====================================================================
   CREATE CUSTOM FIELD
==================================================================== */
exports.createCustomField = (req, res) => {
    const { field_name, field_type, is_required, options, created_by } = req.body;

    console.log("Received Data:", req.body);

    if (!field_name || !field_type) {
        return res.status(400).json({ error: 'Field name and type are required' });
    }

    db.getConnection((err, connection) => {
        if (err) {
            console.error("Connection error:", err);
            return res.status(500).json({ error: "Database connection failed" });
        }

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction failed" });
            }

            const fieldQuery = `
                INSERT INTO lead_custom_fields (field_name, field_type, is_required, created_by)
                VALUES (?, ?, ?, ?)
            `;

            connection.query(
                fieldQuery,
                [field_name, field_type, is_required || false, created_by || null],
                (err, result) => {
                    if (err) {
                        console.log("Failed to insert field:", err);
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ error: "Failed to create custom field" });
                        });
                    }

                    const fieldId = result.insertId;
                    console.log("Inserted Field ID:", fieldId);

                    // If no options, finish transaction
                    if (!options || options.length === 0) {
                        return connection.commit((err) => {
                            connection.release();
                            if (err) {
                                return res.status(500).json({ error: "Transaction commit failed" });
                            }
                            res.status(201).json({
                                message: "Custom field created successfully",
                                field_id: fieldId
                            });
                        });
                    }

                    // Insert options
                    const optionsQuery = `
                        INSERT INTO lead_custom_fields_option (field_id, option_value)
                        VALUES ?
                    `;
                    const optionValues = options.map(opt => [fieldId, opt]);

                    connection.query(optionsQuery, [optionValues], (err) => {
                        if (err) {
                            console.log("Failed to insert options:", err);
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: "Failed to add field options" });
                            });
                        }

                        connection.commit((err) => {
                            connection.release();
                            if (err) {
                                return res.status(500).json({ error: "Transaction commit failed" });
                            }

                            res.status(201).json({
                                message: "Custom field created successfully",
                                field_id: fieldId
                            });
                        });
                    });
                }
            );
        });
    });
};


/* ====================================================================
   GET ALL FIELDS WITH OPTIONS
==================================================================== */
exports.getAllCustomFields = (req, res) => {
    const query = `
        SELECT cf.field_id, cf.field_name, cf.field_type, cf.is_required, cfo.option_value
        FROM lead_custom_fields cf
        LEFT JOIN lead_custom_fields_option cfo ON cf.field_id = cfo.field_id
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: "Failed to fetch custom fields" });

        const fields = results.reduce((acc, row) => {
            const { field_id, field_name, field_type, is_required, option_value } = row;

            if (!acc[field_id]) {
                acc[field_id] = {
                    field_id,
                    field_name,
                    field_type,
                    is_required,
                    options: []
                };
            }

            if (option_value) acc[field_id].options.push(option_value);

            return acc;
        }, {});

        res.status(200).json(Object.values(fields));
    });
};


/* ====================================================================
   UPDATE CUSTOM FIELD
==================================================================== */
exports.updateCustomField = (req, res) => {
    const { field_id } = req.params;
    const { field_name, field_type, is_required, options } = req.body;

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database connection failed" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction failed" });
            }

            const updateQuery = `
                UPDATE lead_custom_fields
                SET field_name = ?, field_type = ?, is_required = ?
                WHERE field_id = ?
            `;

            connection.query(updateQuery, [field_name, field_type, is_required, field_id], (err) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ error: "Failed to update field" });
                    });
                }

                // Delete old options
                const deleteOptionsQuery = `
                    DELETE FROM lead_custom_fields_option WHERE field_id = ?
                `;

                connection.query(deleteOptionsQuery, [field_id], (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ error: "Failed to update options" });
                        });
                    }

                    // If no options, commit
                    if (!options || options.length === 0) {
                        return connection.commit((err) => {
                            connection.release();
                            if (err) {
                                return res.status(500).json({ error: "Transaction commit failed" });
                            }
                            res.status(200).json({ message: "Custom field updated successfully" });
                        });
                    }

                    // Insert new options
                    const optionsQuery = `
                        INSERT INTO lead_custom_fields_option (field_id, option_value)
                        VALUES ?
                    `;
                    const optionValues = options.map(opt => [field_id, opt]);

                    connection.query(optionsQuery, [optionValues], (err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: "Failed to add new options" });
                            });
                        }

                        connection.commit((err) => {
                            connection.release();
                            if (err) {
                                return res.status(500).json({ error: "Transaction commit failed" });
                            }
                            res.status(200).json({ message: "Custom field updated successfully" });
                        });
                    });
                });
            });
        });
    });
};


/* ====================================================================
   DELETE CUSTOM FIELD
==================================================================== */
exports.deleteCustomField = (req, res) => {
    const { field_id } = req.params;

    const deleteQuery = `DELETE FROM lead_custom_fields WHERE field_id = ?`;

    db.query(deleteQuery, [field_id], (err) => {
        if (err) return res.status(500).json({ error: "Failed to delete custom field" });

        res.status(200).json({ message: "Custom field deleted successfully" });
    });
};
