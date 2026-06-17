require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/', (req, res) => {
    res.send('🐾 DigiPet Backend is running!');
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const client = new OpenAI({ apiKey: process.env.KKU_AI_API_KEY, baseURL: process.env.KKU_AI_BASE_URL });

// Auth - Identify or Register
app.get('/api/auth/identify', async (req, res) => {
    const username = req.query.username || req.ip || req.connection.remoteAddress;

    try {
        let { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();

        if (error && error.code === 'PGRST116') { // Not found
            const { data: newUser, error: createError } = await supabase
                .from('users')
                .insert([{ username }])
                .select()
                .single();

            if (createError) throw createError;
            user = newUser;
        } else if (error) {
            throw error;
        }

        res.json({ user });
    } catch (error) {
        console.error('[Auth Error]', error);
        res.status(500).json({ error: 'Auth failed', details: error.message });
    }
});

// Save Game
app.post('/api/save', async (req, res) => {
    const { userId, slotIndex, data, meta } = req.body;

    try {
        const { error } = await supabase
            .from('game_saves')
            .upsert({
                user_id: userId,
                slot_index: slotIndex,
                data_json: data,
                meta_json: meta,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,slot_index' });

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error('[Save Error]', error);
        res.status(500).json({ error: 'Save failed', details: error.message });
    }
});

// Load Game
app.get('/api/load', async (req, res) => {
    const { userId, slotIndex } = req.query;

    try {
        let query = supabase.from('game_saves').select('*').eq('user_id', userId);

        if (slotIndex !== undefined) {
            const { data, error } = await query.eq('slot_index', slotIndex).single();
            if (error && error.code !== 'PGRST116') throw error;

            const result = data ? {
                ...data,
                data: data.data_json,
                meta: data.meta_json
            } : null;
            res.json({ save: result });
        } else {
            const { data, error } = await query.select('slot_index, meta_json');
            if (error) throw error;

            const result = data.map(r => ({
                slotIndex: r.slot_index,
                meta: r.meta_json
            }));
            res.json({ saves: result });
        }
    } catch (error) {
        console.error('[Load Error]', error);
        res.status(500).json({ error: 'Load failed', details: error.message });
    }
});

// Delete Save
app.post('/api/delete', async (req, res) => {
    const { userId, slotIndex } = req.body;
    try {
        const { error } = await supabase
            .from('game_saves')
            .delete()
            .eq('user_id', userId)
            .eq('slot_index', slotIndex);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error('[Delete Error]', error);
        res.status(500).json({ error: 'Delete failed', details: error.message });
    }
});

// AI Generation
app.post('/api/generate-pet', async (req, res) => {
    const { element, stage, tribe } = req.body;
    try {
        const response = await client.chat.completions.create({
            model: "gemini-3.5-flash",
            messages: [
                { role: "system", content: `You are a creative game designer. Generate a unique name, a special trait (short phrase), and a DETAILED physical description (in Thai) for a digital pet. Element: ${element}, Stage: ${stage}, Tribe: ${tribe}` },
                { role: "user", content: "Generate JSON format: { \"name\": \"string\", \"trait\": \"string\", \"description\": \"string\" }" }
            ],
            response_format: { type: "json_object" }
        });
        res.json(JSON.parse(response.choices[0].message.content));
    } catch (error) {
        console.error('[AI Error]', error);
        res.status(500).json({ error: 'AI generation failed' });
    }
});

// AI Battle Simulation
app.post('/api/battle/simulate', async (req, res) => {
    const { playerPet, enemyPet } = req.body;
    try {
        const response = await client.chat.completions.create({
            model: "gemini-1.5-flash",
            messages: [
                { 
                    role: "system", 
                    content: `You are an epic game battle narrator. Simulate a fight between two digital pets.
                    Pet 1: ${playerPet.name} (${playerPet.el} element, ATK: ${playerPet.atk}, DEF: ${playerPet.def})
                    Pet 2: ${enemyPet.name} (${enemyPet.el} element, ATK: ${enemyPet.atk}, DEF: ${enemyPet.def})
                    
                    Generate a 3-5 turn battle script in Thai. Each turn should have:
                    1. "text": Description of the action (vivid and exciting).
                    2. "dmg1": Damage dealt to Pet 1 (if any).
                    3. "dmg2": Damage dealt to Pet 2 (if any).
                    4. "icon": Emoji representing the move.
                    
                    The final turn must result in one pet winning.
                    Return JSON format: { "script": [{ "text": string, "dmg1": number, "dmg2": number, "icon": string }], "winner": 1 or 2 }`
                }
            ],
            response_format: { type: "json_object" }
        });
        res.json(JSON.parse(response.choices[0].message.content));
    } catch (error) {
        console.error('[Battle AI Error]', error);
        res.status(500).json({ error: 'Battle simulation failed' });
    }
});

// === PvP Endpoints ===

// Create PvP Room
app.post('/api/pvp/create', async (req, res) => {
    const { hostId, petData } = req.body;
    try {
        if (!hostId || !petData) throw new Error('Missing hostId or petData');
        const { data, error } = await supabase
            .from('pvp_battles')
            .insert([{
                host_id: hostId,
                host_pet: petData,
                host_hp: petData.hp || 100,
                host_mp: 100,
                current_turn: hostId,
                status: 'waiting'
            }])
            .select()
            .single();

        if (error) throw error;
        res.json({ battleId: data.id });
    } catch (error) {
        console.error('[PvP Create Error]', error);
        res.status(500).json({ error: 'Failed to create room', details: error.message });
    }
});

// Join PvP Room
app.post('/api/pvp/join', async (req, res) => {
    const { battleId, guestId, petData } = req.body;
    try {
        if (!battleId || !guestId || !petData) throw new Error('Missing battleId, guestId or petData');
        const { error } = await supabase
            .from('pvp_battles')
            .update({
                guest_id: guestId,
                guest_pet: petData,
                guest_hp: petData.hp || 100,
                guest_mp: 100,
                status: 'active'
            })
            .eq('id', battleId)
            .eq('status', 'waiting');

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error('[PvP Join Error]', error);
        res.status(500).json({ error: 'Failed to join room', details: error.message });
    }
});

// Get Battle Status
app.get('/api/pvp/status/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('pvp_battles')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get status' });
    }
});

// Submit Action
app.post('/api/pvp/action', async (req, res) => {
    const { battleId, userId, action, newState } = req.body;
    try {
        const { data: battle, error: fetchErr } = await supabase
            .from('pvp_battles')
            .select('*')
            .eq('id', battleId)
            .single();

        if (fetchErr) throw fetchErr;
        if (battle.current_turn !== userId) return res.status(403).json({ error: 'Not your turn' });

        const nextTurn = userId === battle.host_id ? battle.guest_id : battle.host_id;

        const updateData = {
            ...newState,
            current_turn: nextTurn,
            last_action: action,
            updated_at: new Date().toISOString()
        };

        if (newState.status === 'finished') {
            updateData.winner_id = newState.winner_id;
        }

        const { error: updErr } = await supabase
            .from('pvp_battles')
            .update(updateData)
            .eq('id', battleId);

        if (updErr) throw updErr;
        res.json({ success: true });
    } catch (error) {
        console.error('[PvP Action Error]', error);
        res.status(500).json({ error: 'Action failed' });
    }
});

// AI Image Generation (Handles KKU Binary Response -> Base64)
app.post('/api/generate-image', async (req, res) => {
    const { prompt } = req.body;
    try {
        console.log(`[Image AI] Generating for prompt: ${prompt}`);
        
        // URL for Image Generation (OpenAI compatible)
        const apiUrl = `${process.env.KKU_AI_BASE_URL}/images/generations`;
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${process.env.KKU_AI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              prompt: prompt,
              n: 1,
              size: "1024x1024"
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`KKU API Status ${response.status}: ${errText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        console.log(`[Image AI] Response Type: ${contentType}`);

        if (contentType.includes('application/json')) {
            const data = await response.json();
            if (data.data?.[0]?.b64_json) return res.json({ base64: data.data[0].b64_json });
            if (data.data?.[0]?.url) {
                // If it returns a URL, fetch it and convert to base64
                const imgResp = await fetch(data.data[0].url);
                const buffer = await imgResp.arrayBuffer();
                const b64 = Buffer.from(buffer).toString('base64');
                return res.json({ base64: b64 });
            }
            throw new Error('Image data not found in JSON response');
        } else {
            // Raw binary data (Bytes) received
            const buffer = await response.arrayBuffer();
            const b64 = Buffer.from(buffer).toString('base64');
            return res.json({ base64: b64 });
        }
    } catch (error) {
        console.error('[Image AI Error]', error);
        res.status(500).json({ error: 'Image generation failed', details: error.message });
    }
});

const server = http.createServer(app);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`❌ Port ${port} is already in use. Retrying with a different port...`);
    setTimeout(() => {
      server.close();
      server.listen(0); // Listen on a random available port
    }, 1000);
  } else {
    console.error('[Server Error]', e);
  }
});

server.on('listening', () => {
  const addr = server.address();
  console.log(`[DigiPet Server] Running on port: ${addr.port}`);
  console.log(`[Supabase] Connected to: ${process.env.SUPABASE_URL}`);
});

server.listen(port);