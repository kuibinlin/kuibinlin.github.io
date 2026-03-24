// === LinNotes API Worker ===

const ALLOWED_ORIGINS = [
  'https://linsnotes.com',
  'http://127.0.0.1:4000',
  'http://localhost:4000',
];

// === CORS ===
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(request ? corsHeaders(request) : {}),
    },
  });
}

// === Auth Helpers ===
function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  const sessionData = await env.SESSIONS.get(token, 'json');
  if (!sessionData) return null;
  return sessionData;
}

async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) throw { status: 401, message: 'Not authenticated' };
  return user;
}

// === Auth Routes ===
async function handleLogin(request, env) {
  const { email, username } = await request.json();
  if (!email) {
    return json({ error: 'Email is required' }, 400, request);
  }

  // Check if user exists
  const existingUser = await env.DB.prepare('SELECT id, username FROM users WHERE email = ?')
    .bind(email).first();

  if (!existingUser && !username) {
    // New user, need username
    return json({ needsUsername: true, message: 'Welcome! Please pick a username.' }, 200, request);
  }

  if (!existingUser && username) {
    // Check if username is taken
    const taken = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
      .bind(username).first();
    if (taken) {
      return json({ error: 'Username already taken' }, 409, request);
    }
    // Create new user
    await env.DB.prepare('INSERT INTO users (email, username) VALUES (?, ?)')
      .bind(email, username).run();
  }

  const user = existingUser || await env.DB.prepare('SELECT id, username FROM users WHERE email = ?')
    .bind(email).first();
  const displayName = user.username;

  // Generate magic link token
  const token = generateToken();
  await env.SESSIONS.put(`magic:${token}`, JSON.stringify({ email, username: displayName }), {
    expirationTtl: 900, // 15 minutes
  });

  // Send email via Resend
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: email,
      subject: 'Your Linsnotes login link',
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px;">
          <h2>Hi ${displayName}!</h2>
          <p>Click the button below to log in:</p>
          <a href="${env.FRONTEND_URL}#verify=${token}"
             style="display:inline-block;padding:12px 24px;background:#0071e3;color:#fff;
                    text-decoration:none;border-radius:8px;font-weight:600;">
            Log in to MyDeck
          </a>
          <p style="color:#888;font-size:13px;margin-top:20px;">
            This link expires in 15 minutes. If you didn't request this, ignore this email.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return json({ error: 'Failed to send email', detail: err }, 500, request);
  }

  return json({ ok: true, message: 'Check your email for the login link' }, 200, request);
}

async function handleVerify(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'Token required' }, 400, request);

  const data = await env.SESSIONS.get(`magic:${token}`, 'json');
  if (!data) return json({ error: 'Invalid or expired token' }, 401, request);

  // Delete the magic token (one-time use)
  await env.SESSIONS.delete(`magic:${token}`);

  // Get user from DB
  const user = await env.DB.prepare('SELECT id, email, username FROM users WHERE email = ?')
    .bind(data.email).first();
  if (!user) return json({ error: 'User not found' }, 404, request);

  // Create session
  const sessionToken = generateToken();
  await env.SESSIONS.put(sessionToken, JSON.stringify({
    id: user.id,
    email: user.email,
    username: user.username,
  }), {
    expirationTtl: 2592000, // 30 days
  });

  return json({ ok: true, token: sessionToken, user: { id: user.id, username: user.username } }, 200, request);
}

async function handleGitHubAuth(request, env) {
  const redirectUri = `${new URL(request.url).origin}/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user user:email`;
  return Response.redirect(url, 302);
}

async function handleGitHubCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return json({ error: 'No code provided' }, 400, request);

  // Exchange code for token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return Response.redirect(`${env.FRONTEND_URL}#error=auth_failed`, 302);
  }

  // Get GitHub user info
  const userRes = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': 'LinNotes' },
  });
  const ghUser = await userRes.json();

  // Get email if not public
  let email = ghUser.email;
  if (!email) {
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': 'LinNotes' },
    });
    const emails = await emailRes.json();
    const primary = emails.find((e) => e.primary) || emails[0];
    email = primary?.email;
  }

  // Create or find user
  const githubId = String(ghUser.id);
  const username = ghUser.login;

  let user = await env.DB.prepare('SELECT id, username FROM users WHERE github_id = ?')
    .bind(githubId).first();

  if (!user) {
    // Check if username exists, append suffix if needed
    let finalUsername = username;
    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
      .bind(username).first();
    if (existing) {
      finalUsername = `${username}_${githubId.slice(-4)}`;
    }

    await env.DB.prepare(
      'INSERT INTO users (email, username, github_id, github_username) VALUES (?, ?, ?, ?)'
    ).bind(email, finalUsername, githubId, username).run();

    user = await env.DB.prepare('SELECT id, username FROM users WHERE github_id = ?')
      .bind(githubId).first();
  }

  // Create session
  const sessionToken = generateToken();
  await env.SESSIONS.put(sessionToken, JSON.stringify({
    id: user.id,
    email,
    username: user.username,
  }), {
    expirationTtl: 2592000, // 30 days
  });

  return Response.redirect(`${env.FRONTEND_URL}#token=${sessionToken}`, 302);
}

async function handleMe(request, env) {
  const user = await requireUser(request, env);
  return json({ user }, 200, request);
}

async function handleLogout(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (token) await env.SESSIONS.delete(token);
  return json({ ok: true }, 200, request);
}

// === Flashcard Routes ===
async function handleFlashcardDecks(request, env) {
  if (request.method === 'GET') {
    const decks = await env.DB.prepare(`
      SELECT fd.*, u.username as author,
        (SELECT COUNT(*) FROM flashcards WHERE deck_id = fd.id AND is_deleted = 0) as card_count
      FROM flashcard_decks fd
      LEFT JOIN users u ON fd.created_by = u.id
      ORDER BY fd.created_at DESC
    `).all();
    return json({ decks: decks.results }, 200, request);
  }

  if (request.method === 'POST') {
    const user = await requireUser(request, env);
    const { title, category, description } = await request.json();
    if (!title || !category) return json({ error: 'Title and category required' }, 400, request);

    const result = await env.DB.prepare(
      'INSERT INTO flashcard_decks (title, category, description, created_by) VALUES (?, ?, ?, ?)'
    ).bind(title, category, description || null, user.id).run();

    return json({ ok: true, id: result.meta.last_row_id }, 201, request);
  }
}

async function handleFlashcardDeck(request, env, deckId) {
  if (request.method === 'GET') {
    const deck = await env.DB.prepare(`
      SELECT fd.*, u.username as author
      FROM flashcard_decks fd
      LEFT JOIN users u ON fd.created_by = u.id
      WHERE fd.id = ?
    `).bind(deckId).first();
    if (!deck) return json({ error: 'Deck not found' }, 404, request);

    const cards = await env.DB.prepare(
      'SELECT id, front, meaning, note FROM flashcards WHERE deck_id = ? AND is_deleted = 0 ORDER BY created_at'
    ).bind(deckId).all();

    // Get linked challenges
    const links = await env.DB.prepare(`
      SELECT cd.id, cd.title FROM deck_links dl
      JOIN challenge_decks cd ON dl.challenge_deck_id = cd.id
      WHERE dl.flashcard_deck_id = ?
    `).bind(deckId).all();

    return json({ deck, cards: cards.results, linked_challenges: links.results }, 200, request);
  }

  if (request.method === 'PUT') {
    const user = await requireUser(request, env);
    const deck = await env.DB.prepare('SELECT created_by FROM flashcard_decks WHERE id = ?').bind(deckId).first();
    if (!deck) return json({ error: 'Deck not found' }, 404, request);
    if (deck.created_by !== user.id) return json({ error: 'Not your deck' }, 403, request);

    const { title, category, description } = await request.json();
    await env.DB.prepare(
      'UPDATE flashcard_decks SET title = COALESCE(?, title), category = COALESCE(?, category), description = COALESCE(?, description) WHERE id = ?'
    ).bind(title || null, category || null, description || null, deckId).run();

    return json({ ok: true }, 200, request);
  }

  if (request.method === 'DELETE') {
    const user = await requireUser(request, env);
    const deck = await env.DB.prepare('SELECT created_by FROM flashcard_decks WHERE id = ?').bind(deckId).first();
    if (!deck) return json({ error: 'Deck not found' }, 404, request);
    if (deck.created_by !== user.id) return json({ error: 'Not your deck' }, 403, request);

    await env.DB.prepare('DELETE FROM flashcard_decks WHERE id = ?').bind(deckId).run();
    await env.DB.prepare('DELETE FROM flashcards WHERE deck_id = ?').bind(deckId).run();
    await env.DB.prepare('DELETE FROM deck_links WHERE flashcard_deck_id = ?').bind(deckId).run();
    return json({ ok: true }, 200, request);
  }
}

async function handleFlashcardDeckCards(request, env, deckId) {
  const user = await requireUser(request, env);
  const deck = await env.DB.prepare('SELECT created_by FROM flashcard_decks WHERE id = ?').bind(deckId).first();
  if (!deck) return json({ error: 'Deck not found' }, 404, request);
  if (deck.created_by !== user.id) return json({ error: 'Not your deck' }, 403, request);

  const { front, meaning, note } = await request.json();
  if (!front || !meaning) return json({ error: 'Front and meaning required' }, 400, request);

  const result = await env.DB.prepare(
    'INSERT INTO flashcards (deck_id, front, meaning, note) VALUES (?, ?, ?, ?)'
  ).bind(deckId, front, meaning, note || null).run();

  return json({ ok: true, id: result.meta.last_row_id }, 201, request);
}

async function handleFlashcard(request, env, cardId) {
  const user = await requireUser(request, env);
  const card = await env.DB.prepare(`
    SELECT f.deck_id, fd.created_by FROM flashcards f
    JOIN flashcard_decks fd ON f.deck_id = fd.id WHERE f.id = ?
  `).bind(cardId).first();
  if (!card) return json({ error: 'Card not found' }, 404, request);
  if (card.created_by !== user.id) return json({ error: 'Not your deck' }, 403, request);

  if (request.method === 'PUT') {
    const { front, meaning, note } = await request.json();
    await env.DB.prepare(
      'UPDATE flashcards SET front = COALESCE(?, front), meaning = COALESCE(?, meaning), note = ? WHERE id = ?'
    ).bind(front || null, meaning || null, note !== undefined ? note : null, cardId).run();
    return json({ ok: true }, 200, request);
  }

  if (request.method === 'DELETE') {
    await env.DB.prepare('UPDATE flashcards SET is_deleted = 1 WHERE id = ?').bind(cardId).run();
    return json({ ok: true }, 200, request);
  }
}

// === Challenge Routes ===
async function handleChallengeDecks(request, env) {
  if (request.method === 'GET') {
    const decks = await env.DB.prepare(`
      SELECT cd.*, u.username as author,
        (SELECT MAX(version) FROM challenge_versions WHERE deck_id = cd.id) as current_version,
        (SELECT card_count FROM challenge_versions WHERE deck_id = cd.id ORDER BY version DESC LIMIT 1) as card_count
      FROM challenge_decks cd
      LEFT JOIN users u ON cd.created_by = u.id
      ORDER BY cd.created_at DESC
    `).all();
    return json({ decks: decks.results }, 200, request);
  }

  if (request.method === 'POST') {
    const user = await requireUser(request, env);
    const { title, category, description, linked_flashcard_deck_id } = await request.json();
    if (!title || !category) return json({ error: 'Title and category required' }, 400, request);

    const result = await env.DB.prepare(
      'INSERT INTO challenge_decks (title, category, description, created_by) VALUES (?, ?, ?, ?)'
    ).bind(title, category, description || null, user.id).run();

    const challengeId = result.meta.last_row_id;

    // Create deck link if flashcard deck specified
    if (linked_flashcard_deck_id) {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO deck_links (flashcard_deck_id, challenge_deck_id, created_by) VALUES (?, ?, ?)'
      ).bind(linked_flashcard_deck_id, challengeId, user.id).run();
    }

    return json({ ok: true, id: challengeId }, 201, request);
  }
}

async function handleChallengeDeck(request, env, deckId) {
  if (request.method === 'GET') {
    const deck = await env.DB.prepare(`
      SELECT cd.*, u.username as author
      FROM challenge_decks cd
      LEFT JOIN users u ON cd.created_by = u.id
      WHERE cd.id = ?
    `).bind(deckId).first();
    if (!deck) return json({ error: 'Deck not found' }, 404, request);

    // Get latest version
    const version = await env.DB.prepare(
      'SELECT * FROM challenge_versions WHERE deck_id = ? ORDER BY version DESC LIMIT 1'
    ).bind(deckId).first();

    let cards = [];
    if (version) {
      const cardIds = JSON.parse(version.card_ids);
      if (cardIds.length > 0) {
        const placeholders = cardIds.map(() => '?').join(',');
        cards = (await env.DB.prepare(
          `SELECT id, question, choices, answer FROM challenge_cards WHERE id IN (${placeholders})`
        ).bind(...cardIds).all()).results;
      }
    }

    // Get unpublished cards (not in any version)
    const allCards = await env.DB.prepare(
      'SELECT id, question, choices, answer FROM challenge_cards WHERE deck_id = ? AND is_deleted = 0 ORDER BY created_at'
    ).bind(deckId).all();

    // Get linked flashcard decks
    const links = await env.DB.prepare(`
      SELECT fd.id, fd.title FROM deck_links dl
      JOIN flashcard_decks fd ON dl.flashcard_deck_id = fd.id
      WHERE dl.challenge_deck_id = ?
    `).bind(deckId).all();

    return json({
      deck, version, cards: cards,
      all_cards: allCards.results,
      linked_flashcard_decks: links.results,
    }, 200, request);
  }

  if (request.method === 'PUT') {
    const user = await requireUser(request, env);
    const deck = await env.DB.prepare('SELECT created_by FROM challenge_decks WHERE id = ?').bind(deckId).first();
    if (!deck) return json({ error: 'Deck not found' }, 404, request);
    if (deck.created_by !== user.id) return json({ error: 'Not your deck' }, 403, request);

    const { title, category, description } = await request.json();
    await env.DB.prepare(
      'UPDATE challenge_decks SET title = COALESCE(?, title), category = COALESCE(?, category), description = COALESCE(?, description) WHERE id = ?'
    ).bind(title || null, category || null, description || null, deckId).run();
    return json({ ok: true }, 200, request);
  }

  if (request.method === 'DELETE') {
    const user = await requireUser(request, env);
    const deck = await env.DB.prepare('SELECT created_by FROM challenge_decks WHERE id = ?').bind(deckId).first();
    if (!deck) return json({ error: 'Deck not found' }, 404, request);
    if (deck.created_by !== user.id) return json({ error: 'Not your deck' }, 403, request);

    await env.DB.prepare('DELETE FROM challenge_decks WHERE id = ?').bind(deckId).run();
    await env.DB.prepare('DELETE FROM challenge_cards WHERE deck_id = ?').bind(deckId).run();
    await env.DB.prepare('DELETE FROM challenge_versions WHERE deck_id = ?').bind(deckId).run();
    await env.DB.prepare('DELETE FROM deck_links WHERE challenge_deck_id = ?').bind(deckId).run();
    return json({ ok: true }, 200, request);
  }
}

async function handleChallengeDeckCards(request, env, deckId) {
  const user = await requireUser(request, env);
  const deck = await env.DB.prepare('SELECT created_by FROM challenge_decks WHERE id = ?').bind(deckId).first();
  if (!deck) return json({ error: 'Deck not found' }, 404, request);
  if (deck.created_by !== user.id) return json({ error: 'Not your deck' }, 403, request);

  const { question, choices, answer } = await request.json();
  if (!question || !choices || answer === undefined) {
    return json({ error: 'Question, choices, and answer required' }, 400, request);
  }
  if (!Array.isArray(choices) || choices.length !== 4) {
    return json({ error: 'Exactly 4 choices required' }, 400, request);
  }
  if (answer < 0 || answer > 3) {
    return json({ error: 'Answer must be 0-3' }, 400, request);
  }

  const result = await env.DB.prepare(
    'INSERT INTO challenge_cards (deck_id, question, choices, answer) VALUES (?, ?, ?, ?)'
  ).bind(deckId, question, JSON.stringify(choices), answer).run();

  return json({ ok: true, id: result.meta.last_row_id }, 201, request);
}

async function handleChallengeCard(request, env, cardId) {
  const user = await requireUser(request, env);
  const card = await env.DB.prepare(`
    SELECT c.deck_id, cd.created_by FROM challenge_cards c
    JOIN challenge_decks cd ON c.deck_id = cd.id WHERE c.id = ?
  `).bind(cardId).first();
  if (!card) return json({ error: 'Card not found' }, 404, request);
  if (card.created_by !== user.id) return json({ error: 'Not your deck' }, 403, request);

  if (request.method === 'PUT') {
    const { question, choices, answer } = await request.json();
    if (choices && (!Array.isArray(choices) || choices.length !== 4)) {
      return json({ error: 'Exactly 4 choices required' }, 400, request);
    }
    await env.DB.prepare(
      'UPDATE challenge_cards SET question = COALESCE(?, question), choices = COALESCE(?, choices), answer = COALESCE(?, answer) WHERE id = ?'
    ).bind(
      question || null,
      choices ? JSON.stringify(choices) : null,
      answer !== undefined ? answer : null,
      cardId
    ).run();
    return json({ ok: true }, 200, request);
  }

  if (request.method === 'DELETE') {
    await env.DB.prepare('UPDATE challenge_cards SET is_deleted = 1 WHERE id = ?').bind(cardId).run();
    return json({ ok: true }, 200, request);
  }
}

async function handlePublish(request, env, deckId) {
  const user = await requireUser(request, env);
  const deck = await env.DB.prepare('SELECT created_by FROM challenge_decks WHERE id = ?').bind(deckId).first();
  if (!deck) return json({ error: 'Deck not found' }, 404, request);
  if (deck.created_by !== user.id) return json({ error: 'Not your deck' }, 403, request);

  // Get all active cards
  const cards = await env.DB.prepare(
    'SELECT id FROM challenge_cards WHERE deck_id = ? AND is_deleted = 0 ORDER BY created_at'
  ).bind(deckId).all();

  if (cards.results.length < 3) {
    return json({ error: 'Need at least 3 cards to publish' }, 400, request);
  }

  // Get current version number
  const current = await env.DB.prepare(
    'SELECT MAX(version) as v FROM challenge_versions WHERE deck_id = ?'
  ).bind(deckId).first();
  const newVersion = (current?.v || 0) + 1;

  const cardIds = cards.results.map((c) => c.id);
  await env.DB.prepare(
    'INSERT INTO challenge_versions (deck_id, version, card_ids, card_count) VALUES (?, ?, ?, ?)'
  ).bind(deckId, newVersion, JSON.stringify(cardIds), cardIds.length).run();

  return json({ ok: true, version: newVersion, card_count: cardIds.length }, 201, request);
}

// === Score & Leaderboard Routes ===
async function handleScore(request, env) {
  const user = await requireUser(request, env);
  const { challenge_version_id, score, total } = await request.json();

  if (!challenge_version_id || score === undefined || !total) {
    return json({ error: 'challenge_version_id, score, and total required' }, 400, request);
  }

  // Verify version exists
  const version = await env.DB.prepare('SELECT id FROM challenge_versions WHERE id = ?')
    .bind(challenge_version_id).first();
  if (!version) return json({ error: 'Version not found' }, 404, request);

  await env.DB.prepare(
    'INSERT INTO scores (user_id, challenge_version_id, score, total) VALUES (?, ?, ?, ?)'
  ).bind(user.id, challenge_version_id, score, total).run();

  return json({ ok: true }, 201, request);
}

async function handleLeaderboard(request, env, versionId) {
  const scores = await env.DB.prepare(`
    SELECT s.score, s.total, s.created_at, u.username,
           ROUND(s.score * 100.0 / s.total) as percentage
    FROM scores s
    JOIN users u ON s.user_id = u.id
    WHERE s.challenge_version_id = ?
    ORDER BY percentage DESC, s.created_at ASC
    LIMIT 50
  `).bind(versionId).all();

  const version = await env.DB.prepare(`
    SELECT cv.*, cd.title as deck_title
    FROM challenge_versions cv
    JOIN challenge_decks cd ON cv.deck_id = cd.id
    WHERE cv.id = ?
  `).bind(versionId).first();

  return json({ version, scores: scores.results }, 200, request);
}

async function handleLeaderboardSummary(request, env) {
  // Get top 3 scores for the latest version of each challenge deck
  const decks = await env.DB.prepare(`
    SELECT cd.id, cd.title, cv.id as version_id, cv.version, cv.card_count
    FROM challenge_decks cd
    JOIN challenge_versions cv ON cv.deck_id = cd.id
    WHERE cv.version = (SELECT MAX(version) FROM challenge_versions WHERE deck_id = cd.id)
    ORDER BY cd.created_at DESC
  `).all();

  const summary = [];
  for (const deck of decks.results) {
    const top3 = await env.DB.prepare(`
      SELECT u.username, s.score, s.total, ROUND(s.score * 100.0 / s.total) as percentage
      FROM scores s
      JOIN users u ON s.user_id = u.id
      WHERE s.challenge_version_id = ?
      ORDER BY percentage DESC, s.created_at ASC
      LIMIT 3
    `).bind(deck.version_id).all();

    if (top3.results.length > 0) {
      summary.push({
        deck_id: deck.id,
        title: deck.title,
        version: deck.version,
        version_id: deck.version_id,
        card_count: deck.card_count,
        top3: top3.results,
      });
    }
  }

  return json({ summary }, 200, request);
}

// === Deck Link Routes ===
async function handleDeckLinks(request, env) {
  if (request.method === 'POST') {
    const user = await requireUser(request, env);
    const { flashcard_deck_id, challenge_deck_id } = await request.json();
    if (!flashcard_deck_id || !challenge_deck_id) {
      return json({ error: 'Both deck IDs required' }, 400, request);
    }

    await env.DB.prepare(
      'INSERT OR IGNORE INTO deck_links (flashcard_deck_id, challenge_deck_id, created_by) VALUES (?, ?, ?)'
    ).bind(flashcard_deck_id, challenge_deck_id, user.id).run();

    return json({ ok: true }, 201, request);
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const fcId = url.searchParams.get('flashcard_deck_id');
    const chId = url.searchParams.get('challenge_deck_id');

    let links;
    if (fcId) {
      links = await env.DB.prepare(`
        SELECT dl.id, cd.id as challenge_deck_id, cd.title
        FROM deck_links dl JOIN challenge_decks cd ON dl.challenge_deck_id = cd.id
        WHERE dl.flashcard_deck_id = ?
      `).bind(fcId).all();
    } else if (chId) {
      links = await env.DB.prepare(`
        SELECT dl.id, fd.id as flashcard_deck_id, fd.title
        FROM deck_links dl JOIN flashcard_decks fd ON dl.flashcard_deck_id = fd.id
        WHERE dl.challenge_deck_id = ?
      `).bind(chId).all();
    } else {
      return json({ error: 'Provide flashcard_deck_id or challenge_deck_id' }, 400, request);
    }

    return json({ links: links.results }, 200, request);
  }
}

async function handleDeckLinkDelete(request, env, linkId) {
  const user = await requireUser(request, env);
  await env.DB.prepare('DELETE FROM deck_links WHERE id = ? AND created_by = ?')
    .bind(linkId, user.id).run();
  return json({ ok: true }, 200, request);
}

// === Router ===
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      // Auth routes
      if (path === '/auth/login' && method === 'POST') return await handleLogin(request, env);
      if (path === '/auth/verify' && method === 'GET') return await handleVerify(request, env);
      if (path === '/auth/github' && method === 'GET') return await handleGitHubAuth(request, env);
      if (path === '/auth/github/callback' && method === 'GET') return await handleGitHubCallback(request, env);
      if (path === '/auth/me' && method === 'GET') return await handleMe(request, env);
      if (path === '/auth/logout' && method === 'POST') return await handleLogout(request, env);

      // Flashcard deck routes
      if (path === '/api/flashcard-decks' && (method === 'GET' || method === 'POST')) {
        return await handleFlashcardDecks(request, env);
      }
      let match = path.match(/^\/api\/flashcard-decks\/(\d+)$/);
      if (match) return await handleFlashcardDeck(request, env, parseInt(match[1]));

      match = path.match(/^\/api\/flashcard-decks\/(\d+)\/cards$/);
      if (match && method === 'POST') return await handleFlashcardDeckCards(request, env, parseInt(match[1]));

      match = path.match(/^\/api\/flashcards\/(\d+)$/);
      if (match) return await handleFlashcard(request, env, parseInt(match[1]));

      // Challenge deck routes
      if (path === '/api/challenge-decks' && (method === 'GET' || method === 'POST')) {
        return await handleChallengeDecks(request, env);
      }
      match = path.match(/^\/api\/challenge-decks\/(\d+)$/);
      if (match) return await handleChallengeDeck(request, env, parseInt(match[1]));

      match = path.match(/^\/api\/challenge-decks\/(\d+)\/cards$/);
      if (match && method === 'POST') return await handleChallengeDeckCards(request, env, parseInt(match[1]));

      match = path.match(/^\/api\/challenge-decks\/(\d+)\/publish$/);
      if (match && method === 'POST') return await handlePublish(request, env, parseInt(match[1]));

      match = path.match(/^\/api\/challenge-cards\/(\d+)$/);
      if (match) return await handleChallengeCard(request, env, parseInt(match[1]));

      // Score & Leaderboard
      if (path === '/api/scores' && method === 'POST') return await handleScore(request, env);
      if (path === '/api/leaderboard-summary' && method === 'GET') return await handleLeaderboardSummary(request, env);

      match = path.match(/^\/api\/leaderboard\/(\d+)$/);
      if (match && method === 'GET') return await handleLeaderboard(request, env, parseInt(match[1]));

      // Deck links
      if (path === '/api/deck-links' && (method === 'GET' || method === 'POST')) {
        return await handleDeckLinks(request, env);
      }
      match = path.match(/^\/api\/deck-links\/(\d+)$/);
      if (match && method === 'DELETE') return await handleDeckLinkDelete(request, env, parseInt(match[1]));

      return json({ error: 'Not found' }, 404, request);
    } catch (err) {
      if (err.status) return json({ error: err.message }, err.status, request);
      console.error(err);
      return json({ error: 'Internal server error' }, 500, request);
    }
  },
};
