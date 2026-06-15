require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

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
  const { element, stage, tribe } = req.body;
  try {
    const response = await client.chat.completions.create({
      model: "gemini-1.5-pro", // Updated to a more standard model name if needed, but keeping user's intent
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

app.listen(port, () => {
  console.log(`[DigiPet Server] Running on http://localhost:${port}`);
  console.log(`[Supabase] Connected to: ${process.env.SUPABASE_URL}`);
});
