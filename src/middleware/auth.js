import jwt from "jsonwebtoken";
import { jwtConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";


// Function to issue access token
export function issueAccessToken(user) {
    return jwt.sign(
        {
            sub: String(user._id),
            email: user.email,
            name: user.name
        },
        jwtConfig.secret,
        { expiresIn: jwtConfig.accessTokenTtlSec })

};

// Function to issue refresh token
export function issueRefreshToken(user) {
    return jwt.sign({
        sub: String(user._id),
        type: 'refresh'
    },
        jwtConfig.secret,
        { expiresIn: jwtConfig.refreshTokenTtlSec })
}

//Verify jwt Token
export function requireAuth(req, res, next) {
    //extract token from request header
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    //verify token
    if (!token) {
        return res.status(401).json({ success: false, error: 'Missing token' })
    }

    //ok => attach payload to next step
    try {
        const payload = jwt.verify(token, jwtConfig.secret);

        req.user = { userId: payload.sub, email: payload.email, name: payload.name };
        return next();
    } catch (err) {
        logger.error(err);
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
}