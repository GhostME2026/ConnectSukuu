
'use strict';

const prisma = require('../config/db');

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

function publicProfile(user) {
  if (!user) return user;
  
  const result = { ...user };
  
  if (
    typeof result.photoUrl === 'string' &&
    result.photoUrl.startsWith('data:image/')
  ) {
    result.photoUrl = '/api/auth/profile/photo';
  }
  
  return result;
}

async function findUserProfile(userId) {
  const rows = await prisma.$queryRaw`
  SELECT "id", "email", "phone", "firstName", "lastName",
  "role", "schoolId", "branchId", "photoUrl", "createdAt"
  FROM "User"
  WHERE "id" = ${userId}
  LIMIT 1
  `;
  
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function getProfile(req, res) {
  try {
    const user = await findUserProfile(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        error: 'User account not found.'
      });
    }
    
    return res.json({ user: publicProfile(user) });
  } catch (error) {
    console.error('auth.getProfile:', error);
    
    return res.status(500).json({
      error: 'Could not load the saved profile.'
    });
  }
}

async function getProfilePhoto(req, res) {
  try {
    const rows = await prisma.$queryRaw`
    SELECT "photoUrl"
    FROM "User"
    WHERE "id" = ${req.user.id}
    LIMIT 1
    `;
    
    const value =
    Array.isArray(rows) && rows[0]
    ? rows[0].photoUrl
    : null;
    
    if (
      typeof value !== 'string' ||
      !value.startsWith('data:image/')
    ) {
      return res.status(404).json({
        error: 'No database-stored profile photo is available.'
      });
    }
    
    const match = value.match(
      /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/
    );
    
    if (!match) {
      return res.status(415).json({
        error: 'The saved profile photo format is not supported.'
      });
    }
    
    const image = Buffer.from(match[2], 'base64');
    
    if (!image.length || image.length > 5 * 1024 * 1024) {
      return res.status(415).json({
        error: 'The saved profile photo is invalid or exceeds 5 MB.'
      });
    }
    
    res.set('Content-Type', match[1]);
    res.set('Content-Length', String(image.length));
    res.set('Cache-Control', 'private, no-cache, must-revalidate');
    res.set('X-Content-Type-Options', 'nosniff');
    
    return res.status(200).send(image);
  } catch (error) {
    console.error('auth.getProfilePhoto:', error);
    
    return res.status(500).json({
      error: 'Could not load the profile photo.'
    });
  }
}

async function saveProfilePhoto(req, res) {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({
      error: 'Choose a valid image file first.'
    });
  }
  
  if (!ALLOWED_MIME.has(req.file.mimetype)) {
    return res.status(400).json({
      error: 'Profile photos must be PNG, JPG, WEBP or GIF images.'
    });
  }
  
  if (req.file.buffer.length > 5 * 1024 * 1024) {
    return res.status(400).json({
      error: 'Profile photos must be 5 MB or smaller.'
    });
  }
  
  try {
    // PostgreSQL storage survives application refreshes and redeployments.
    const photoUrl =
    `data:${req.file.mimetype};base64,` +
    req.file.buffer.toString('base64');
    
    const changed = await prisma.$executeRaw`
    UPDATE "User"
    SET "photoUrl" = ${photoUrl}
    WHERE "id" = ${req.user.id}
    `;
    
    if (changed < 1) {
      return res.status(404).json({
        error: 'User account not found.'
      });
    }
    
    const user = await findUserProfile(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        error: 'User account not found.'
      });
    }
    
    res.set('Cache-Control', 'no-store');
    
    return res.status(200).json({
      user: publicProfile(user),
                                message: 'Profile photo saved.'
    });
  } catch (error) {
    console.error('auth.saveProfilePhoto:', error);
    
    return res.status(500).json({
      error: 'Could not save the profile photo. Please try again.'
    });
  }
}

module.exports = {
  getProfile,
  getProfilePhoto,
  saveProfilePhoto
};
