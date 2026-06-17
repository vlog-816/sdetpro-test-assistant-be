import { Router } from "express";
import User from "../models/User.js";
import { issueAccessToken, issueRefreshToken } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

const router = Router();

//POST - auth/register : Register a new user
router.post('/register', async (req, res, next) => {

    const { email, name, password } = req.body;

    try {
        // Validate required field
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            })
        }

        //Check if user already exists
        const exists = await User.findOne({ email });
        if (exists) {
            return res.status(400).json({
                success: false,
                error: 'Email already registered'
            })
        }

        //Register user
        const user = new User({ email, name });

        //Hash password
        await user.setPassword(password);


        //Save to database
        await user.save()

        //Generate token
        const accessToken = issueAccessToken(user);
        const refreshToken = issueRefreshToken(user);

        return res.status(201).json({
            success: true,
            data: {
                accessToken,
                refreshToken,
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.name
                }
            }
        });
    } catch (e) {
        next(e);
    }
})

router.post('/login', async (req, res, next) => {

    //check input
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(422).json({
            success: false,
            error: "Missing username or password"
        });
    }

    try {

        //check DB
        const user = await User.findOne({ email });
        logger.info(user);

        if (!user || !(await user.validatePassword(password))) {
            return res.status(401).json({
                success: false,
                error: "Invalid credentials"
            });
        }

        //genarate token

        const accessToken = issueAccessToken(user);
        const refreshToken = issueRefreshToken(user);

        //return res
        return res.status(200).json({
            success: true,
            data: {
                accessToken,
                refreshToken,
                user: { id: user._id, email: user.email, name: user.name }
            }
        })
    } catch (error) {
        next(error);
    }
})

export default router;