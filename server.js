require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

// AI Generation
app.post('/api/generate-pet', async (req, res) => {
... (existing code) ...
});

// === PvP Endpoints ===

// Create PvP Room
app.post('/api/pvp/create', async (req, res) => {
  const { hostId, petData } = req.body;
  try {
    const { data, error } = await supabase
      .from('pvp_battles')
      .insert([{
        host_id: hostId,
        host_pet: petData,
        host_hp: petData.hp,
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
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Join PvP Room
app.post('/api/pvp/join', async (req, res) => {
  const { battleId, guestId, petData } = req.body;
  try {
    const { error } = await supabase
      .from('pvp_battles')
      .update({
        guest_id: guestId,
        guest_pet: petData,
        guest_hp: petData.hp,
        guest_mp: 100,
        status: 'active'
      })
      .eq('id', battleId)
      .eq('status', 'waiting');

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('[PvP Join Error]', error);
    res.status(500).json({ error: 'Failed to join room' });
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

app.listen(port, () => {
  console.log(`[DigiPet Server] Running on http://localhost:${port}`);
  console.log(`[Supabase] Connected to: ${process.env.SUPABASE_URL}`);
});
