import { Router } from 'express';
import multer from 'multer';
import cloudinary from './cloudinaryConfig.js';
import { TravelCategory } from './models/index.js';


const router = Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Category name is required" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Image file is required" });
    }

    // Convert file buffer to base64 string for Cloudinary upload
    const fileStr = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    const uploadedResponse = await cloudinary.uploader.upload(fileStr, {
      folder: 'categories',
    });

    const newCategory = new TravelCategory({
      name,
      imageUrl: uploadedResponse.secure_url,
    });

    await newCategory.save();

    res.status(201).json({ message: 'Category created successfully', data: newCategory });
  } catch (error) {
    console.error('Error in category upload:', error);
    res.status(500).json({ error: error.message || 'Failed to upload category' });
  }
});

export default router;
