import express from "express";
import { ask } from "../controllers/askController.js";

const router = express.Router();

router.post("/ask", ask);

export default router;
