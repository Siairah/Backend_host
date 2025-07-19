import { Schema, model } from 'mongoose';
const travelCategorySchema = new Schema({
    name: {
        type: String, 
        required: true,
        unique: true,
    },
    imageUrl: {
        type: String,
        required: true,

    }
});
const TravelCategory = model ("TravelCategory", travelCategorySchema);
export default TravelCategory;