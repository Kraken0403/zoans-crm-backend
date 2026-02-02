const db = require('../config/db');

// -------------------- PRODUCTS --------------------

const getAllProducts = async (req, res) => {
  try {
    const [categories] = await db.promise().query(
      `SELECT id, name, parent_id FROM categories`
    );

    const categoryMap = {};
    categories.forEach(c => (categoryMap[c.id] = c));

    const getCategoryChain = (catId) => {
      if (!catId) return 'Uncategorized';
      const chain = [];
      let current = categoryMap[catId];
      while (current) {
        chain.unshift(current.name);
        current = categoryMap[current.parent_id];
      }
      return chain.join(' > ');
    };

    const [products] = await db.promise().query(`
    SELECT 
      p.id,
      p.name,
      p.brand,
      p.description,
      p.image_url,
  
  
      p.cost_pricing_mode,
      p.cost_discount_percent,
  
      p.cost_price,
      p.cost_price_unit,
      p.cost_price_qty,
  
      p.selling_price,
      p.selling_price_unit,
      p.selling_price_qty,
  
      p.gst_rate,
      p.hsn_sac,
  
      p.stock,
      p.category_id,
      p.type,
      p.sku,
      p.is_active,
      p.created_at,
  
      COUNT(v.id) AS variant_count
    FROM products p
    LEFT JOIN variants v 
      ON p.id = v.product_id AND v.is_active = 1
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `);
  

    const enriched = products.map(p => ({
      ...p,
      category_name: getCategoryChain(p.category_id)
    }));

    res.status(200).json(enriched);

  } catch (err) {
    console.error('❌ getAllProducts:', err);
    res.status(500).json({
      error: 'Failed to fetch products',
      details: err.message
    });
  }
};

const getProductById = async (req, res) => {
  const { id } = req.params;

  try {
    const [[product]] = await db.promise().query(
      `
      SELECT 
      id,
      name,
      brand,
      description,
      image_url,


      cost_pricing_mode,
      cost_discount_percent,

      cost_price,
      cost_price_unit,
      cost_price_qty,

      selling_price,
      selling_price_unit,
      selling_price_qty,

      gst_rate,
      hsn_sac,

      stock,
      category_id,
      type,
      sku,
      is_active,
      created_at
    FROM products
    WHERE id = ?

      `,
      [id]
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const [variantsRaw] = await db.promise().query(
      `
      SELECT 
        v.id AS variant_id,
        v.sku,
        v.stock,
        v.cost AS cost_price,
        v.cost_unit AS cost_price_unit,

        pp.packaging_type,
        pp.packaging_weight,
        pp.packaging_unit,
        pp.length,
        pp.width,
        pp.height,
        pp.dimensions_unit
      FROM variants v
      LEFT JOIN product_packaging pp ON pp.variant_id = v.id
      WHERE v.product_id = ? AND v.is_active = 1
      `,
      [id]
    );

    if (!variantsRaw.length) {
      return res.json({ ...product, variants: [] });
    }

    const variantIds = variantsRaw.map(v => v.variant_id);

    const [attrRows] = await db.promise().query(
      `
      SELECT 
        vav.variant_id,
        ao.id AS option_id,
        ao.value,
        ao.attribute_id
      FROM variant_attribute_values vav
      JOIN attribute_options ao ON ao.id = vav.attribute_option_id
      WHERE vav.variant_id IN (?)
      `,
      [variantIds]
    );

    const variantMap = {};

    variantsRaw.forEach(v => {
      variantMap[v.variant_id] = {
        id: v.variant_id,
        sku: v.sku,
        stock: v.stock,
        cost_price: v.cost_price,
        cost_price_unit: v.cost_price_unit,
        attributes: [],
        packaging: {
          packaging_type: v.packaging_type,
          packaging_weight: v.packaging_weight,
          packaging_unit: v.packaging_unit,
          length: v.length,
          width: v.width,
          height: v.height,
          dimensions_unit: v.dimensions_unit
        }
      };
    });

    attrRows.forEach(a => {
      if (variantMap[a.variant_id]) {
        variantMap[a.variant_id].attributes.push({
          id: a.option_id,
          value: a.value,
          attribute_id: a.attribute_id
        });
      }
    });

    res.json({
      ...product,
      variants: Object.values(variantMap)
    });

  } catch (err) {
    console.error('❌ getProductById:', err);
    res.status(500).json({
      error: 'Failed to fetch product',
      details: err.message
    });
  }
};


const createProduct = (req, res) => {
  const {
    name,
    brand = null,
    category_id = 1,
    description = '',
    image_url = null,

    // Pricing mode
    cost_pricing_mode = 'absolute', // 'absolute' | 'percentage'
    cost_discount_percent = null,

    // Cost
    cost_price = 0,
    cost_price_unit = 'piece',
    cost_price_qty = 1,

    // Selling price (required)
    selling_price,
    selling_price_unit = 'piece',
    selling_price_qty = 1,

    // GST
    gst_rate = 0,
    hsn_sac = null,

    stock = 0,
    sku = '',
    type = 'simple',
    is_active = 1,
    variants = []
  } = req.body;

  /* ---------------- VALIDATIONS ---------------- */

  if (!name) {
    return res.status(400).json({ error: 'Product name is required' });
  }

  if (brand && brand.length > 100) {
    return res.status(400).json({ error: 'Brand must be under 100 characters' });
  }

  if (selling_price == null || selling_price <= 0) {
    return res.status(400).json({
      error: 'selling_price is required and must be > 0'
    });
  }

  if (gst_rate < 0 || gst_rate > 28) {
    return res.status(400).json({
      error: 'Invalid gst_rate'
    });
  }

  if (cost_pricing_mode === 'percentage' && cost_price > 0) {
    return res.status(400).json({
      error: 'Do not send cost_price when pricing mode is percentage'
    });
  }

  if (
    cost_pricing_mode === 'percentage' &&
    (cost_discount_percent == null || cost_discount_percent <= 0)
  ) {
    return res.status(400).json({
      error: 'cost_discount_percent is required for percentage pricing'
    });
  }

  /* ---------------- COST CALCULATION ---------------- */

  let finalCostPrice = cost_price;

  if (cost_pricing_mode === 'percentage') {
    finalCostPrice =
      selling_price * (1 - cost_discount_percent / 100);
  }

  /* ---------------- INSERT PRODUCT ---------------- */

  const insertProductQuery = `
    INSERT INTO products (
      name,
      brand,
      category_id,
      description,
      image_url,

      cost_pricing_mode,
      cost_discount_percent,

      cost_price,
      cost_price_unit,
      cost_price_qty,

      selling_price,
      selling_price_unit,
      selling_price_qty,

      gst_rate,
      hsn_sac,

      stock,
      sku,
      type,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    insertProductQuery,
    [
      name,
      brand,
      category_id,
      description,
      image_url,

      cost_pricing_mode,
      cost_discount_percent,

      finalCostPrice,
      cost_price_unit,
      cost_price_qty,

      selling_price,
      selling_price_unit,
      selling_price_qty,

      Number(gst_rate || 0),
      hsn_sac,

      stock,
      sku,
      type,
      is_active
    ],
    (err, result) => {
      if (err) {
        return res.status(500).json({
          error: 'Failed to create product',
          details: err.message
        });
      }

      const productId = result.insertId;

      /* -------- SIMPLE PRODUCT -------- */
      if (type !== 'variable' || !Array.isArray(variants) || !variants.length) {
        return res.status(201).json({
          message: 'Product created successfully',
          id: productId
        });
      }

      /* -------- VARIABLE PRODUCT -------- */

      const variantValues = variants.map(v => [
        productId,
        v.sku || '',
        v.stock || 0,
        v.cost_price ?? finalCostPrice,
        v.cost_price_unit ?? cost_price_unit,
        1
      ]);

      const insertVariantsQuery = `
        INSERT INTO variants
        (product_id, sku, stock, cost, cost_unit, is_active)
        VALUES ?
      `;

      db.query(insertVariantsQuery, [variantValues], err2 => {
        if (err2) {
          return res.status(500).json({
            error: 'Product created but variants failed',
            details: err2.message
          });
        }

        return res.status(201).json({
          message: 'Product with variants created successfully',
          id: productId
        });
      });
    }
  );
};


const updateProduct = async (req, res) => {
  const { id } = req.params;

  const {
    name,
    brand = null,
    category_id,
    description = '',
    image_url = null,

    // Pricing mode
    cost_pricing_mode = 'absolute',
    cost_discount_percent = null,

    // Cost
    cost_price = 0,
    cost_price_unit = 'piece',
    cost_price_qty = 1,

    // Selling price
    selling_price,
    selling_price_unit = 'piece',
    selling_price_qty = 1,

    // GST
    gst_rate = 0,
    hsn_sac = null,

    stock = 0,
    sku = '',
    type = 'simple',
    is_active = 1,
    variants = []
  } = req.body;

  let connection;

  try {
    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    /* ---------------- FETCH EXISTING PRODUCT ---------------- */

    const [[existingProduct]] = await connection.query(
      `SELECT selling_price FROM products WHERE id = ?`,
      [id]
    );

    if (!existingProduct) {
      throw new Error('Product not found');
    }

    const effectiveSellingPrice =
      selling_price ?? existingProduct.selling_price;

    /* ---------------- VALIDATIONS ---------------- */

    if (!name) {
      throw new Error('Product name is required');
    }

    if (brand && brand.length > 100) {
      throw new Error('Brand must be under 100 characters');
    }

    if (effectiveSellingPrice <= 0) {
      throw new Error('selling_price must be > 0');
    }

    if (gst_rate < 0 || gst_rate > 28) {
      throw new Error('Invalid gst_rate');
    }

    if (cost_pricing_mode === 'percentage') {
      if (!cost_discount_percent || cost_discount_percent <= 0) {
        throw new Error('cost_discount_percent is required for percentage pricing');
      }
      if (cost_price > 0) {
        throw new Error('Do not send cost_price in percentage pricing mode');
      }
    }

    /* ---------------- COST CALCULATION ---------------- */

    let finalCostPrice = cost_price;

    if (cost_pricing_mode === 'percentage') {
      finalCostPrice =
        effectiveSellingPrice * (1 - cost_discount_percent / 100);
    }

    /* ---------------- UPDATE PRODUCT ---------------- */

    await connection.query(
      `
      UPDATE products SET
        name=?,
        brand=?,
        category_id=?,
        description=?,
        image_url=?,

        cost_pricing_mode=?,
        cost_discount_percent=?,

        cost_price=?,
        cost_price_unit=?,
        cost_price_qty=?,

        selling_price=?,
        selling_price_unit=?,
        selling_price_qty=?,

        gst_rate=?,
        hsn_sac=?,

        stock=?,
        sku=?,
        type=?,
        is_active=?
      WHERE id=?
    `,
      [
        name,
        brand,
        category_id,
        description,
        image_url,

        cost_pricing_mode,
        cost_discount_percent,

        finalCostPrice,
        cost_price_unit,
        cost_price_qty,

        effectiveSellingPrice,
        selling_price_unit,
        selling_price_qty,

        Number(gst_rate || 0),
        hsn_sac,

        stock,
        sku,
        type,
        is_active,
        id
      ]
    );

    /* ---------------- VARIANT HANDLING ---------------- */

    const [existingVariants] = await connection.query(
      'SELECT id FROM variants WHERE product_id = ?',
      [id]
    );

    const existingIds = existingVariants.map(v => v.id);
    const incomingIds = variants.filter(v => v.id).map(v => v.id);

    const removed = existingIds.filter(v => !incomingIds.includes(v));
    if (removed.length) {
      await connection.query(
        'UPDATE variants SET is_active = 0 WHERE id IN (?)',
        [removed]
      );
    }

    for (const v of variants.filter(v => v.id)) {
      await connection.query(
        `
        UPDATE variants SET
          sku=?,
          stock=?,
          cost=?,
          cost_unit=?,
          is_active=1
        WHERE id=? AND product_id=?
      `,
        [
          v.sku || '',
          v.stock || 0,
          v.cost_price ?? finalCostPrice,
          v.cost_price_unit ?? cost_price_unit,
          v.id,
          id
        ]
      );
    }

    for (const v of variants.filter(v => !v.id)) {
      await connection.query(
        `
        INSERT INTO variants
        (product_id, sku, stock, cost, cost_unit, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `,
        [
          id,
          v.sku || '',
          v.stock || 0,
          v.cost_price ?? finalCostPrice,
          v.cost_price_unit ?? cost_price_unit
        ]
      );
    }

    await connection.commit();
    connection.release();

    return res.status(200).json({
      message: 'Product updated successfully'
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }

    console.error('❌ updateProduct error:', error.message);

    return res.status(500).json({
      error: 'Failed to update product',
      details: error.message
    });
  }
};


const deleteProduct = async (req, res) => {
  const { id } = req.params;
  let connection;

  try {
    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    const [variants] = await connection.query(
      'SELECT id FROM variants WHERE product_id = ?',
      [id]
    );

    const variantIds = variants.map(v => v.id);

    if (variantIds.length) {
      const [qRows] = await connection.query(
        `SELECT COUNT(*) AS cnt FROM quotation_items WHERE variant_id IN (?)`,
        [variantIds]
      );

      if (qRows[0].cnt > 0) {
        throw new Error(
          'Cannot delete product: variants already used in quotations'
        );
      }

      await connection.query(
        'DELETE FROM variant_attribute_values WHERE variant_id IN (?)',
        [variantIds]
      );

      await connection.query(
        'DELETE FROM product_packaging WHERE variant_id IN (?)',
        [variantIds]
      );

      await connection.query(
        'DELETE FROM variants WHERE product_id = ?',
        [id]
      );
    }

    await connection.query(
      'DELETE FROM product_packaging WHERE product_id = ?',
      [id]
    );

    const [result] = await connection.query(
      'DELETE FROM products WHERE id = ?',
      [id]
    );

    if (!result.affectedRows) {
      throw new Error('Product not found');
    }

    await connection.commit();
    connection.release();

    res.status(200).json({
      message: 'Product deleted successfully'
    });

  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('❌ deleteProduct:', err);
    res.status(500).json({
      error: 'Failed to delete product',
      details: err.message
    });
  }
};

// -------------------- VARIANTS --------------------
const createVariant = (req, res) => {
  const { product_id, sku, price, stock } = req.body;

  if (!product_id || !sku || price === undefined || stock === undefined) {
    return res.status(400).json({ error: 'Missing required fields for variant' });
  }

  const query = `INSERT INTO variants (product_id, sku, price, stock) VALUES (?, ?, ?, ?)`;

  db.query(query, [product_id, sku, price, stock], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to create variant', details: err.message });
    res.status(201).json({ message: 'Variant created successfully', variantId: result.insertId });
  });
};

const getVariantByProductId = (req, res) => {
  const query = 'SELECT * FROM variants WHERE product_id = ?';
  db.query(query, [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch variants', details: err.message });
    res.status(200).json(result);
  });
};


// -------------------- VARIANT + ATTRIBUTES (COMBINED) --------------------
const createVariantWithAttributes = (req, res) => {
  const { product_id, stock, sku, price, attribute_option_ids } = req.body;

  if (!product_id || !sku || !price || !Array.isArray(attribute_option_ids) || attribute_option_ids.length === 0) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  const productTypeQuery = 'SELECT type FROM products WHERE id = ?';
  db.query(productTypeQuery, [product_id], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error', details: err.message });

    if (results.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (results[0].type !== 'variable') {
      return res.status(400).json({ error: 'Cannot create variants for a simple product' });
    }

    const insertVariantQuery = `
      INSERT INTO variants (product_id, stock, sku, price)
      VALUES (?, ?, ?, ?)
    `;

    db.query(insertVariantQuery, [product_id, stock, sku, price], (err2, result) => {
      if (err2) return res.status(500).json({ error: 'Failed to create variant', details: err2.message });

      const variantId = result.insertId;

      const variantAttrValues = attribute_option_ids.map(id => [variantId, id]);
      const variantAttrQuery = `
        INSERT INTO variant_attribute_options (variant_id, attribute_option_id) VALUES ?
      `;

      db.query(variantAttrQuery, [variantAttrValues], (err3) => {
        if (err3) return res.status(500).json({ error: 'Failed to link attributes', details: err3.message });

        res.status(201).json({ message: 'Variant created successfully', variantId });
      });
    });
  });
};


const getVariantsByProduct = async (req, res) => {
  try {
    const [variants] = await db.promise().query(
      `
      SELECT v.*,
             GROUP_CONCAT(ao.value SEPARATOR ', ') AS attribute_values
      FROM variants v
      LEFT JOIN variant_attribute_values vav ON v.id = vav.variant_id
      LEFT JOIN attribute_options ao ON vav.attribute_option_id = ao.id
      WHERE v.product_id = ? AND v.is_active = 1
      GROUP BY v.id
      `,
      [req.params.productId]
    );

    res.status(200).json(variants);

  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch variants',
      details: err.message
    });
  }
};


// -------------------- VARIANT ATTRIBUTE VALUES --------------------
const addVariantAttributeValue = async (req, res) => {
  const { variant_id, attribute_option_id } = req.body;

  if (!variant_id || !attribute_option_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await db.promise().query(
      `
      INSERT INTO variant_attribute_values
      (variant_id, attribute_option_id)
      VALUES (?, ?)
      `,
      [variant_id, attribute_option_id]
    );

    res.status(201).json({
      message: 'Attribute option added to variant'
    });

  } catch (err) {
    res.status(500).json({
      error: 'Failed to link attribute',
      details: err.message
    });
  }
};

const getAttributesForVariant = async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `
      SELECT a.name AS attribute, ao.value AS optionValue
      FROM variant_attribute_values vav
      JOIN attribute_options ao ON vav.attribute_option_id = ao.id
      JOIN attributes a ON ao.attribute_id = a.id
      WHERE vav.variant_id = ?
      `,
      [req.params.id]
    );

    res.status(200).json(rows);

  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch variant attributes',
      details: err.message
    });
  }
};

// -------------------- CATEGORIES --------------------
const createCategory = (req, res) => {
  const { category, parent_id } = req.body;

  if (!category) return res.status(400).json({ error: 'Missing required field: category' });

  const slug = category.toLowerCase().replace(/\s+/g, '-');
  const checkQuery = 'SELECT * FROM categories WHERE slug = ?';

  db.query(checkQuery, [slug], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to check slug', details: err.message });
    if (results.length > 0) return res.status(409).json({ error: 'Slug already exists' });

    const createQuery = 'INSERT INTO categories (name, slug, parent_id) VALUES (?, ?, ?)';
    db.query(createQuery, [category, slug, parent_id || null], (err2, result) => {
      if (err2) return res.status(500).json({ error: 'Failed to create category', details: err2.message });
      res.status(201).json({ message: 'Category created successfully', categoryId: result.insertId });
    });
  });
};

const getCategories = (req, res) => {
  const query = `
    SELECT 
      c.id,
      c.name,
      c.slug,
      c.parent_id,
      COUNT(p.id) AS product_count
    FROM categories c
    LEFT JOIN products p 
      ON p.category_id = c.id
    GROUP BY c.id
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({
        error: 'Failed to fetch categories',
        details: err.message
      });
    }

    const categoriesMap = {};
    const rootCategories = [];

    // Prepare map
    results.forEach(category => {
      category.children = [];
      category.product_count = Number(category.product_count) || 0;
      categoriesMap[category.id] = category;
    });

    // Build tree
    results.forEach(category => {
      if (category.parent_id) {
        categoriesMap[category.parent_id]?.children.push(category);
      } else {
        rootCategories.push(category);
      }
    });

    res.status(200).json(rootCategories);
  });
};


const getCategoryById = (req, res) => {
  const query = 'SELECT * FROM categories WHERE id = ?';
  db.query(query, [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch category', details: err.message });
    if (results.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.status(200).json(results[0]);
  });
};

const getCategoryByName = (req, res) => {
  const name = req.params.name;
  const query = 'SELECT * FROM categories WHERE name = ?';

  db.query(query, [name], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch category by name', details: err.message });
    if (results.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.status(200).json(results[0]);
  });
};

const checkCategory = (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing required field: name' });

  const slug = name.toLowerCase().replace(/\s+/g, '-');
  const query = 'SELECT * FROM categories WHERE slug = ?';

  db.query(query, [slug], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to check category', details: err.message });

    res.status(200).json({ exists: results.length > 0 });
  });
};

const updateCategory = (req, res) => {
  const { id } = req.params;
  const { name, parent_id } = req.body;

  const slug = name.toLowerCase().replace(/\s+/g, '-');

  const query = `UPDATE categories SET name = ?, slug = ?, parent_id = ? WHERE id = ?`;
  db.query(query, [name, slug, parent_id || null, id], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to update category', details: err.message });
    res.status(200).json({ message: 'Category updated successfully' });
  });
};

const deleteCategory = (req, res) => {
  const { id } = req.params;

  // 1️⃣ Check if category has products
  const checkProductsQuery =
    'SELECT COUNT(*) AS count FROM products WHERE category_id = ?';

  db.query(checkProductsQuery, [id], (err, productRows) => {
    if (err) {
      return res.status(500).json({
        error: 'Failed to check products',
        details: err.message
      });
    }

    if (productRows[0].count > 0) {
      return res.status(409).json({
        error: 'Category has products. Remove or reassign them first.'
      });
    }

    // 2️⃣ Check if category has child categories
    const checkChildrenQuery =
      'SELECT COUNT(*) AS count FROM categories WHERE parent_id = ?';

    db.query(checkChildrenQuery, [id], (err2, childRows) => {
      if (err2) {
        return res.status(500).json({
          error: 'Failed to check child categories',
          details: err2.message
        });
      }

      if (childRows[0].count > 0) {
        return res.status(409).json({
          error: 'Category has child categories. Delete them first.'
        });
      }

      // 3️⃣ Safe to delete
      const deleteQuery = 'DELETE FROM categories WHERE id = ?';

      db.query(deleteQuery, [id], (err3) => {
        if (err3) {
          return res.status(500).json({
            error: 'Failed to delete category',
            details: err3.message
          });
        }

        res.status(200).json({
          message: 'Category deleted successfully'
        });
      });
    });
  });
};



// -------------------- ATTRIBUTES --------------------
const createAttribute = (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing attribute name' });

  const query = `INSERT INTO attributes (name) VALUES (?)`;
  db.query(query, [name], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to create attribute', details: err.message });
    res.status(201).json({ message: 'Attribute created', attributeId: result.insertId });
  });
};

const getAllAttributes = (req, res) => {
  const query = `SELECT * FROM attributes`;
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch attributes', details: err.message });
    res.status(200).json(results);
  });
};


// -------------------- UPDATE ATTRIBUTE --------------------
const updateAttribute = (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Missing attribute name' });
  }

  const query = `UPDATE attributes SET name = ? WHERE id = ?`;

  db.query(query, [name, id], (err, result) => {
    if (err) {
      return res.status(500).json({
        error: 'Failed to update attribute',
        details: err.message
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Attribute not found' });
    }

    res.status(200).json({ message: 'Attribute updated successfully' });
  });
};

// -------------------- DELETE ATTRIBUTE --------------------
const deleteAttribute = (req, res) => {
  const { id } = req.params;

  // 1️⃣ Check if attribute is used anywhere
  const usageQuery = `
    SELECT COUNT(*) AS count
    FROM product_attribute_options pao
    JOIN attribute_options ao ON ao.id = pao.attribute_option_id
    WHERE ao.attribute_id = ?
  `;

  db.query(usageQuery, [id], (err, usageResult) => {
    if (err) {
      return res.status(500).json({
        error: 'Failed to check attribute usage',
        details: err.message
      });
    }

    if (usageResult[0].count > 0) {
      return res.status(409).json({
        error: 'Attribute is used in products. Remove or replace it first.'
      });
    }

    // 2️⃣ Delete attribute options first
    const deleteOptionsQuery = `DELETE FROM attribute_options WHERE attribute_id = ?`;

    db.query(deleteOptionsQuery, [id], (err) => {
      if (err) {
        return res.status(500).json({
          error: 'Failed to delete attribute options',
          details: err.message
        });
      }

      // 3️⃣ Delete attribute
      const deleteAttrQuery = `DELETE FROM attributes WHERE id = ?`;

      db.query(deleteAttrQuery, [id], (err, result) => {
        if (err) {
          return res.status(500).json({
            error: 'Failed to delete attribute',
            details: err.message
          });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({ error: 'Attribute not found' });
        }

        res.status(200).json({ message: 'Attribute deleted successfully' });
      });
    });
  });
};

// -------------------- ATTRIBUTE OPTIONS --------------------
const createAttributeOption = (req, res) => {
  const attribute_id = req.params.id;
  const { value } = req.body;

  if (!attribute_id || !value) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const query = `INSERT INTO attribute_options (attribute_id, value) VALUES (?, ?)`;
  db.query(query, [attribute_id, value], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to create attribute option', details: err.message });
    res.status(201).json({ message: 'Attribute option created', optionId: result.insertId });
  });
};

const getAttributeOptions = (req, res) => {
  const attributeId = req.params.id;
  const query = `SELECT * FROM attribute_options WHERE attribute_id = ?`;

  db.query(query, [attributeId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch attribute options', details: err.message });
    res.status(200).json(results);
  });
};

// -------------------- DELETE ATTRIBUTE OPTION --------------------
const deleteAttributeOption = (req, res) => {
  const { optionId } = req.params;

  // Prevent deleting option used in products
  const usageQuery = `
    SELECT COUNT(*) AS count
    FROM product_attribute_options
    WHERE attribute_option_id = ?
  `;

  db.query(usageQuery, [optionId], (err, result) => {
    if (err) {
      return res.status(500).json({
        error: 'Failed to check option usage',
        details: err.message
      });
    }

    if (result[0].count > 0) {
      return res.status(409).json({
        error: 'Option is used in products. Remove it from products first.'
      });
    }

    const query = `DELETE FROM attribute_options WHERE id = ?`;

    db.query(query, [optionId], (err, result) => {
      if (err) {
        return res.status(500).json({
          error: 'Failed to delete attribute option',
          details: err.message
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Attribute option not found' });
      }

      res.status(200).json({ message: 'Attribute option deleted successfully' });
    });
  });
};


// -------------------- ASSIGN ATTRIBUTE TO PRODUCT --------------------
const assignAttributeToProduct = (req, res) => {
  const { attribute_option_ids } = req.body;
  const { productId } = req.params;

  if (!Array.isArray(attribute_option_ids) || attribute_option_ids.length === 0) {
    return res.status(400).json({ error: 'Attribute Option IDs must be a non-empty array' });
  }

  const values = attribute_option_ids.map(id => [productId, id]);
  const query = `INSERT INTO product_attribute_options (product_id, attribute_option_id) VALUES ?`;

  db.query(query, [values], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to assign attributes to product', details: err.message });
    }

    res.status(201).json({ message: 'Attributes assigned successfully' });
  });
};


// -------------------- PACKAGING --------------------
const addPackaging = (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Packaging name is required' });

  const query = `INSERT INTO packagings (name) VALUES (?)`;
  db.query(query, [name], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to add packaging', details: err.message });
    res.status(201).json({ message: 'Packaging created', packagingId: result.insertId });
  });
};


// Add packaging for a simple product
const addProductPackaging = (req, res) => {
  const productId = req.params.productId;
  const {
    packagingType,
    packagingWeight,
    packagingUnit,
    length,
    width,
    height,
    dimensionsUnit
  } = req.body;

  const checkQuery = 'SELECT id FROM product_packaging WHERE product_id = ?';
  db.query(checkQuery, [productId], (err, existing) => {
    if (err) return res.status(500).json({ error: 'Error checking existing packaging', details: err.message });

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Packaging already exists for this product.' });
    }

    const insertQuery = `
      INSERT INTO product_packaging 
      (product_id, packaging_type, packaging_weight, packaging_unit, length, width, height, dimensions_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.query(insertQuery, [
      productId, packagingType, packagingWeight, packagingUnit,
      length, width, height, dimensionsUnit
    ], (err2) => {
      if (err2) return res.status(500).json({ error: 'Failed to add packaging', details: err2.message });
      res.status(201).json({ message: 'Packaging added successfully.' });
    });
  });
};


// Get packaging for a simple product
const getProductPackaging = (req, res) => {
  const productId = req.params.productId;

  const query = `
    SELECT id, packaging_type, packaging_weight, packaging_unit,
           length, width, height, dimensions_unit
    FROM product_packaging
    WHERE product_id = ?
  `;
  db.query(query, [productId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch packaging', details: err.message });
    res.status(200).json(results);
  });
};


// Add packaging for a variant
const addVariantPackaging = (req, res) => {
  const variantId = req.params.variantId;
  const {
    packagingType,
    packagingWeight,
    packagingUnit,
    length,
    width,
    height,
    dimensionsUnit
  } = req.body;

  const checkQuery = 'SELECT id FROM product_packaging WHERE variant_id = ?';
  db.query(checkQuery, [variantId], (err, existing) => {
    if (err) return res.status(500).json({ error: 'Error checking existing packaging', details: err.message });

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Packaging already exists for this variant.' });
    }

    const insertQuery = `
      INSERT INTO product_packaging 
      (variant_id, packaging_type, packaging_weight, packaging_unit, length, width, height, dimensions_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.query(insertQuery, [
      variantId, packagingType, packagingWeight, packagingUnit,
      length, width, height, dimensionsUnit
    ], (err2) => {
      if (err2) return res.status(500).json({ error: 'Failed to add packaging', details: err2.message });
      res.status(201).json({ message: 'Packaging added successfully.' });
    });
  });
};


// Remove product packaging
const removeProductPackaging = (req, res) => {
  const productId = req.params.productId;

  const deleteQuery = 'DELETE FROM product_packagings WHERE product_id = ?';
  db.query(deleteQuery, [productId], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to delete packaging', details: err.message });

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No packaging found for this product.' });
    }

    res.json({ message: 'Packaging removed successfully.' });
  });
};

// Remove variant packaging
const removeVariantPackaging = (req, res) => {
  const variantId = req.params.variantId;

  const deleteQuery = 'DELETE FROM variant_packagings WHERE variant_id = ?';
  db.query(deleteQuery, [variantId], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to delete packaging', details: err.message });

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No packaging found for this variant.' });
    }

    res.json({ message: 'Packaging removed successfully.' });
  });
};


// Get packaging for a variant
const getVariantPackaging = (req, res) => {
  const variantId = req.params.variantId;

  const query = `
    SELECT id, packaging_type, packaging_weight, packaging_unit,
           length, width, height, dimensions_unit
    FROM product_packaging
    WHERE variant_id = ?
  `;
  db.query(query, [variantId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch packaging', details: err.message });
    res.status(200).json(results);
  });
};



module.exports = {
  // Products
  getAllProducts,
  createProduct,
  getProductById,
  updateProduct,
  deleteProduct,

  // Variants
  createVariant,
  getVariantByProductId,
  createVariantWithAttributes,
  getVariantsByProduct,

  // Variant attribute mapping
  addVariantAttributeValue,
  getAttributesForVariant,

  // Categories
  createCategory,
  updateCategory,
  deleteCategory,
  getCategories,
  getCategoryById,
  getCategoryByName,
  checkCategory,

  // Attributes
  createAttribute,
  getAllAttributes,
  deleteAttribute,
  updateAttribute,
  deleteAttributeOption,

  // Attribute Options
  createAttributeOption,
  getAttributeOptions,

  // Product–Attribute mapping
  assignAttributeToProduct,

  // Packaging
  addPackaging,
  addProductPackaging,
  getProductPackaging,
  addVariantPackaging,
  getVariantPackaging,
  removeProductPackaging,
  removeVariantPackaging
};

