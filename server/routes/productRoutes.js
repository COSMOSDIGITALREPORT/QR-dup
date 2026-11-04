const express = require('express');
const router = express.Router();
const {
  createProduct,
  getProducts,
  getProduct,
  downloadQR,
  updateProduct,
  deleteProduct,
  previewProductGroup,
  deleteProductGroup,
} = require('../controllers/productController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(protect);

router.get('/group/delete-preview', allowRoles('superadmin'), previewProductGroup);
router.delete('/group/:name',       allowRoles('superadmin'), deleteProductGroup);

router.post('/', allowRoles('superadmin', 'admin'), upload.single('image'), createProduct);
router.get('/',        allowRoles('superadmin', 'admin'), getProducts);
router.get('/:id/qr',  allowRoles('superadmin', 'admin'), downloadQR);
router.get('/:id',     allowRoles('superadmin', 'admin'), getProduct);
router.put('/:id',     allowRoles('superadmin', 'admin'), updateProduct);
router.delete('/:id',  allowRoles('superadmin'), deleteProduct);

module.exports = router;
