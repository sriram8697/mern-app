 require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 5001;
const User = require('./User');
const AuthLog = require('./AuthLog');
const Recipe = require('./Recipe');
const Notification = require('./Notification');
const NewsletterSubscriber = require('./NewsletterSubscriber');
const seedRecipes = require('./seedRecipes');

app.use(cors({ origin: true }));
app.use(express.json({ limit: '6mb' }));

function makeToken(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

async function requireAuth(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !process.env.JWT_SECRET) return res.status(401).json({ message: 'Please log in to continue.' });
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return res.status(401).json({ message: 'Your session is invalid. Please log in again.' });
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return res.status(401).json({ message: 'Your session is invalid. Please log in again.' }); }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.status(401).json({ message: 'Your session is invalid. Please log in again.' });
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!claims.sub || claims.exp < Date.now()) return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
    const user = await User.findById(claims.sub).select('isActive');
    if (!user) return res.status(401).json({ message: 'Account not found. Please log in again.' });
    if (!user.isActive) return res.status(403).json({ message: 'This account is blocked. Contact the Savor admin.' });
    req.userId = claims.sub;
    return next();
  } catch {
    return res.status(503).json({ message: 'Could not verify your session.' });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('role');
    if (!user || user.role !== 'admin') return res.status(403).json({ message: 'Admin access is required.' });
    next();
  } catch (error) {
    console.error('Admin authorization failed:', error.message);
    return res.status(503).json({ message: 'Could not verify admin access.' });
  }
}

async function recordAuthEvent(email, action, userId = null) {
  try {
    await AuthLog.create({ email, action, userId });
  } catch (error) {
    console.error('Could not save auth log:', error.message);
  }
}

async function notifyRecipeOwner(recipe, type, message) {
  if (!recipe.submittedBy) return;
  await Notification.create({ userId: recipe.submittedBy, recipeId: recipe._id, recipeName: recipe.name, type, message });
}

function isValidRecipeImage(image) {
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image || '');
  if (!match || Buffer.byteLength(image) > 5600000) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (match[1] === 'jpeg' || match[1] === 'jpg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => {
    if (error) reject(error);
    else resolve(`${salt}:${key.toString('hex')}`);
  }));
}

async function passwordMatches(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const key = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(key.split(':')[1], 'hex'), Buffer.from(hash, 'hex'));
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2) return res.status(400).json({ message: 'Please enter your name.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    if (!/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/.test(password)) {
      return res.status(400).json({ message: 'Use at least 8 characters, including a letter, a number, and a symbol.' });
    }
    if (await User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists.' });
    const user = await User.create({ name, email, passwordHash: await hashPassword(password) });
    await recordAuthEvent(email, 'signup', user.id);
    return res.status(201).json({ token: makeToken(user.id), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'An account with this email already exists.' });
    console.error('Signup failed:', error);
    return res.status(503).json({ message: 'Account service is unavailable. Check the server database settings.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await passwordMatches(password, user.passwordHash))) {
      await recordAuthEvent(email || 'unknown', 'login_failed', user?.id || null);
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }
    if (!user.isActive) {
      await recordAuthEvent(email, 'login_failed', user.id);
      return res.status(403).json({ message: 'This account is blocked. Contact the Savor admin.' });
    }
    await recordAuthEvent(email, 'login_success', user.id);
    return res.json({ token: makeToken(user.id), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(503).json({ message: 'Account service is unavailable. Check the server database settings.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('name email role isActive');
    if (!user) return res.status(401).json({ message: 'Account not found. Please log in again.' });
    return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Session lookup failed:', error);
    return res.status(503).json({ message: 'Account service is unavailable.' });
  }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.userId, readAt: null }).sort({ createdAt: -1 }).limit(20);
    return res.json({ notifications });
  } catch (error) {
    console.error('Notification lookup failed:', error.message);
    return res.status(503).json({ message: 'Could not load recipe notifications.' });
  }
});

app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.userId, readAt: null }, { $set: { readAt: new Date() } });
    return res.json({ message: 'Notification marked as read.' });
  } catch (error) {
    console.error('Notification update failed:', error.message);
    return res.status(400).json({ message: 'Could not update this notification.' });
  }
});

app.post('/api/newsletter/subscribe', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });

  try {
    await NewsletterSubscriber.findOneAndUpdate(
      { email },
      {
        $set: { active: true },
        $setOnInsert: { email },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return res.status(200).json({ message: 'Your email has been saved in the database.' });
  } catch (error) {
    console.error('Newsletter subscription failed:', error.message);
    return res.status(503).json({ message: 'Could not save your subscription. Please try again.' });
  }
});

app.get('/api/recipes', async (_req, res) => {
  try {
    await Recipe.deleteOne({ seedKey: 'creamy-tuscan-gnocchi' });
    const biryani = seedRecipes.find((recipe) => recipe.seedKey === 'hyderabadi-chicken-dum-biryani');
    if (biryani?.image) {
      await Recipe.updateOne(
        { seedKey: biryani.seedKey },
        { $set: { image: biryani.image } },
      );
    }
    const recipes = await Recipe.find({ status: 'approved' }).sort({ createdAt: -1 }).limit(200);
    return res.json({ recipes });
  } catch (error) {
    console.error('Approved recipe list failed:', error.message);
    return res.status(503).json({ message: 'Could not load community recipes.' });
  }
});

app.post('/api/recipes', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const category = String(req.body.category || '');
    const time = Number(req.body.time);
    const image = req.body.image ? String(req.body.image) : undefined;
    const ingredients = Array.isArray(req.body.ingredients)
      ? req.body.ingredients.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (name.length < 3 || name.length > 100) return res.status(400).json({ message: 'Recipe name must be between 3 and 100 characters.' });
    if (!['Breakfast', 'Lunch', 'Dinner'].includes(category)) return res.status(400).json({ message: 'Choose Breakfast, Lunch, or Dinner.' });
    if (!Number.isInteger(time) || time < 1 || time > 600) return res.status(400).json({ message: 'Prep time must be between 1 and 600 minutes.' });
    if (description.length < 10 || description.length > 600) return res.status(400).json({ message: 'Description must be between 10 and 600 characters.' });
    if (ingredients.length < 2 || ingredients.length > 40 || ingredients.some((item) => item.length > 200)) {
      return res.status(400).json({ message: 'Add between 2 and 40 ingredients, each no more than 200 characters.' });
    }
    if (image && !isValidRecipeImage(image)) {
      return res.status(400).json({ message: 'Use a PNG, JPEG, or WebP image smaller than 4 MB.' });
    }
    const recipe = await Recipe.create({ name, category, time, description, ingredients, image, submittedBy: req.userId });
    return res.status(201).json({ recipe, message: 'Recipe submitted for admin review.' });
  } catch (error) {
    console.error('Recipe submission failed:', error.message);
    return res.status(503).json({ message: 'Could not submit the recipe. Please try again.' });
  }
});

app.patch('/api/admin/recipes/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const recipe = await Recipe.findOne({ _id: req.params.id, status: { $in: ['pending', 'approved'] } });
    if (!recipe) return res.status(404).json({ message: 'That recipe was not found.' });
    const wasPublished = recipe.status === 'approved';
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const category = String(req.body.category || '');
    const time = Number(req.body.time);
    const ingredients = Array.isArray(req.body.ingredients)
      ? req.body.ingredients.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const image = req.body.image ? String(req.body.image) : recipe.image;
    if (name.length < 3 || name.length > 100) return res.status(400).json({ message: 'Recipe name must be between 3 and 100 characters.' });
    if (!['Breakfast', 'Lunch', 'Dinner'].includes(category)) return res.status(400).json({ message: 'Choose Breakfast, Lunch, or Dinner.' });
    if (!Number.isInteger(time) || time < 1 || time > 600) return res.status(400).json({ message: 'Prep time must be between 1 and 600 minutes.' });
    if (description.length < 10 || description.length > 600) return res.status(400).json({ message: 'Description must be between 10 and 600 characters.' });
    if (ingredients.length < 2 || ingredients.length > 40 || ingredients.some((item) => item.length > 200)) {
      return res.status(400).json({ message: 'Add between 2 and 40 ingredients, each no more than 200 characters.' });
    }
    if (image && !image.startsWith('photo-') && !isValidRecipeImage(image)) {
      return res.status(400).json({ message: 'Use a PNG, JPEG, or WebP image smaller than 4 MB.' });
    }
    recipe.name = name;
    recipe.description = description;
    recipe.category = category;
    recipe.time = time;
    recipe.ingredients = ingredients;
    recipe.image = image;
    recipe.reviewMessage = wasPublished
      ? 'An admin updated your published recipe.'
      : 'An admin edited your recipe. It is still waiting for approval.';
    await recipe.save();
    await notifyRecipeOwner(recipe, 'modified', recipe.reviewMessage);
    return res.json({ recipe, message: wasPublished ? 'Published recipe updated.' : 'Recipe updated and remains pending review.' });
  } catch (error) {
    console.error('Recipe edit failed:', error.message);
    return res.status(400).json({ message: 'Could not update this recipe.' });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await User.find().select('name email role isActive createdAt').sort({ createdAt: -1 }).limit(200);
    return res.json({ users });
  } catch (error) {
    console.error('Admin user list failed:', error.message);
    return res.status(503).json({ message: 'Could not load users.' });
  }
});

app.patch('/api/admin/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') return res.status(400).json({ message: 'Choose whether the account should be active.' });
    if (req.params.id === req.userId) return res.status(400).json({ message: 'You cannot block your own admin account.' });
    const target = await User.findById(req.params.id).select('name email role isActive');
    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (!isActive && target.role === 'admin' && target.isActive && await User.countDocuments({ role: 'admin', isActive: true }) <= 1) {
      return res.status(409).json({ message: 'The last active admin account cannot be blocked.' });
    }
    target.isActive = isActive;
    await target.save();
    return res.json({ user: { id: target.id, name: target.name, email: target.email, role: target.role, isActive: target.isActive } });
  } catch (error) {
    console.error('User status update failed:', error.message);
    return res.status(400).json({ message: 'Could not update this account.' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.userId) return res.status(400).json({ message: 'You cannot remove your own admin account.' });
    const target = await User.findById(req.params.id).select('name email role isActive');
    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (target.role === 'admin' && target.isActive && await User.countDocuments({ role: 'admin', isActive: true }) <= 1) {
      return res.status(409).json({ message: 'The last active admin account cannot be removed.' });
    }
    const recipeResult = await Recipe.deleteMany({ submittedBy: target._id });
    await AuthLog.deleteMany({ $or: [{ userId: target._id }, { email: target.email }] });
    await Notification.deleteMany({ userId: target._id });
    await target.deleteOne();
    return res.json({ message: 'User and their submitted recipes were removed.', removedRecipes: recipeResult.deletedCount });
  } catch (error) {
    console.error('User removal failed:', error.message);
    return res.status(400).json({ message: 'Could not remove this user.' });
  }
});

app.get('/api/admin/recipes/pending', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const recipes = await Recipe.find({ status: 'pending' }).populate('submittedBy', 'name email').sort({ createdAt: 1 }).limit(200);
    return res.json({ recipes });
  } catch (error) {
    console.error('Pending recipe list failed:', error.message);
    return res.status(503).json({ message: 'Could not load recipes for review.' });
  }
});

app.get('/api/admin/recipes/published', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const recipes = await Recipe.find({ status: 'approved' }).populate('submittedBy', 'name email').sort({ updatedAt: -1 }).limit(200);
    return res.json({ recipes });
  } catch (error) {
    console.error('Published recipe list failed:', error.message);
    return res.status(503).json({ message: 'Could not load published recipes.' });
  }
});

app.patch('/api/admin/recipes/:id/review', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { decision } = req.body;
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Choose approve or reject.' });
    const recipe = await Recipe.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { status: decision, reviewedAt: new Date(), reviewMessage: decision === 'approved' ? 'Your recipe was approved and is now published.' : 'Your recipe was not approved for publication.' },
      { returnDocument: 'after', runValidators: true },
    );
    if (!recipe) return res.status(404).json({ message: 'That pending recipe was not found.' });
    await notifyRecipeOwner(recipe, decision, recipe.reviewMessage);
    return res.json({ recipe, message: `Recipe ${decision}.` });
  } catch (error) {
    console.error('Recipe review failed:', error.message);
    return res.status(400).json({ message: 'Could not review this recipe.' });
  }
});

app.delete('/api/admin/recipes/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const recipe = await Recipe.findOne({ _id: req.params.id, status: { $ne: 'removed' } });
    if (!recipe) return res.status(404).json({ message: 'Recipe not found.' });
    recipe.status = 'removed';
    recipe.reviewedAt = new Date();
    recipe.reviewMessage = 'An admin removed this recipe from Savor.';
    await recipe.save();
    await notifyRecipeOwner(recipe, 'removed', recipe.reviewMessage);
    return res.json({ message: 'Recipe removed and its owner notified.' });
  } catch (error) {
    console.error('Recipe removal failed:', error.message);
    return res.status(400).json({ message: 'Could not remove this recipe.' });
  }
});

app.get('/api/admin/logs', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const logs = await AuthLog.find().select('email action createdAt').sort({ createdAt: -1 }).limit(200);
    return res.json({ logs });
  } catch (error) {
    console.error('Admin auth logs failed:', error.message);
    return res.status(503).json({ message: 'Could not load sign-in activity.' });
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', (_req, res) => res.status(404).json({ message: 'API route not found.' }));

if (process.env.NODE_ENV === 'production') {
  const clientBuildPath = path.resolve(__dirname, '../client/dist');
  app.use(express.static(clientBuildPath));
  app.get(/.*/, (_req, res, next) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
} else {
  app.get('/', (_req, res) => res.send('Savor backend is running.'));
}

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
  if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
      .then(async () => {
        console.log('Connected to MongoDB');
        await User.updateMany({ isActive: { $exists: false } }, { $set: { isActive: true } });
        await Recipe.updateMany({ image: 'photo-1547592180-85f173990554', $or: [{ source: 'community' }, { source: { $exists: false } }] }, { $unset: { image: '' } });
        await Recipe.deleteOne({ seedKey: 'creamy-tuscan-gnocchi' });
        for (const recipe of seedRecipes) {
          await Recipe.updateOne({ seedKey: recipe.seedKey }, { $setOnInsert: recipe }, { upsert: true });
        }
        const biryani = seedRecipes.find((recipe) => recipe.seedKey === 'hyderabadi-chicken-dum-biryani');
        if (biryani?.image) {
          await Recipe.updateOne(
            { seedKey: biryani.seedKey },
            { $set: { image: biryani.image } },
          );
        }
        const adminEmail = String(process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
        const adminPassword = process.env.SUPERADMIN_PASSWORD || '';
        if (adminEmail && adminPassword) {
          const validAdminPassword = adminPassword.length >= 8 && /[A-Za-z]/.test(adminPassword) && /[^A-Za-z0-9\s]/.test(adminPassword);
          if (!/^\S+@\S+\.\S+$/.test(adminEmail) || !validAdminPassword) {
            console.error('Super admin not configured: use a valid email and a password with at least 8 characters, a letter, and a symbol.');
            return;
          }
          await User.updateMany({ role: 'admin', email: { $ne: adminEmail } }, { $set: { role: 'user' } });
          const admin = await User.findOne({ email: adminEmail }).select('+passwordHash');
          if (admin) {
            admin.name = admin.name || 'Super Admin';
            admin.role = 'admin';
            admin.isActive = true;
            admin.passwordHash = await hashPassword(adminPassword);
            await admin.save();
          } else {
            await User.create({ name: 'Super Admin', email: adminEmail, passwordHash: await hashPassword(adminPassword), role: 'admin' });
          }
          console.log(`Super admin account ready for ${adminEmail}`);
        } else {
          console.warn('Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD in server/.env to enable admin access.');
        }
      })
      .catch((error) => console.error('MongoDB connection failed:', error.message));
  } else {
    console.warn('Set MONGODB_URI in server/.env to enable account signup and login.');
  }
});
