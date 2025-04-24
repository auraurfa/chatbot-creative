// ======= DEPENDENCIES =======
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const { Client: NotionClient } = require('@notionhq/client');
const axios = require('axios');

// ======== CONFIGURATION ========
const NOTION_API_KEY = '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';
const DATABASE_ID = '1d9364bdbba880d39157cad14e4b939c';
const PARENT_PAGE_ID = '1d9364bdbba880d18bb0c8b037c1e718';
const OLLAMA_MODEL = 'gemma:2b';

const notion = new NotionClient({ auth: NOTION_API_KEY });

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './wwebjs_auth',
    clientId: "client-1"
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    timeout: 60000
  },
  qrTimeoutMs: 60000
});

// ======== HELPER FUNCTIONS ========
let NOTION_USERS_CACHE = [];

async function refreshUserCache() {
  try {
    const response = await notion.users.list({});
    NOTION_USERS_CACHE = response.results;
    console.log('✅ User cache updated');
  } catch (err) {
    console.error('❌ Failed to refresh user cache:', err);
  }
}

function findUserByNameOrEmail(nameOrEmail) {
  return NOTION_USERS_CACHE.find(user => 
    user.name?.toLowerCase() === nameOrEmail.toLowerCase() ||
    user.person?.email?.toLowerCase() === nameOrEmail.toLowerCase()
  );
}

async function handleGenerateBrief(content, message) {
  try {
    const titleMatch = content.match(/generate brief (.+?) dengan deskripsi :/i);
    if (!titleMatch) {
      return await message.reply('❌ Format salah. Gunakan: generate brief [judul] dengan deskripsi : [deskripsi]');
    }
    
    const title = titleMatch[1].trim();
    const description = content.split('deskripsi :')[1].trim();
    
    if (!description) {
      return await message.reply('❌ Deskripsi tidak boleh kosong');
    }

    // Kirim pesan "Brief sedang dibuat" sebelum memulai proses pembuatan brief
    await message.reply('🔄 *Brief sedang dibuat, mohon ditunggu...*');

    // Proses pembuatan brief
    const brief = await generateBrief(title, description);

    // Kirim hasil brief setelah selesai
    await message.reply(`📝 *Brief untuk "${title}"*:\n\n${brief}`);
  } catch (err) {
    console.error('Error generating brief:', err);
    await message.reply('❌ Gagal membuat brief. Silakan coba lagi.');
  }
}

async function generateBrief(title, description) {
  try {
    // Kirim pesan bahwa proses pembuatan brief sedang berlangsung
    console.log(`🔄 Brief untuk tugas "${title}" sedang dibuat... Harap tunggu sebentar.`);
    
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: OLLAMA_MODEL,
      prompt: `Buatkan brief formal dan menarik untuk tugas berjudul "${title}" berdasarkan deskripsi berikut:\n"${description}". 
      Tulis brief seolah-olah kamu sedang memberikan arahan kerja kepada seorang desainer atau tim kreatif. Gunakan bahasa yang profesional namun tetap engaging. 

      Struktur brief:
      1. Latar belakang singkat
      2. Tujuan utama tugas
      3. Copywriting & isi konten yang harus dimasukkan
      4. Harapan visual atau konten (jika relevan)
      5. Gaya atau tone yang diinginkan
      6. Catatan tambahan jika ada

      Pastikan brief mudah dipahami, padat, dan langsung ke inti.`,
      stream: false
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 100000
    });

    const brief = response.data.response;

    // Jika brief berhasil dihasilkan, kirim pesan bahwa brief telah dibuat
    console.log(`✅ Brief untuk "${title}" berhasil dibuat.`);
    return `📝 ${brief}\n\n✨ *Brief telah berhasil dibuat!* 🎨\n\nJika ada hal lain yang perlu diubah atau jika kamu ingin memperbarui brief lebih lanjut, cukup ketik *"regenerate brief / ${title}"* dan beri catatan tambahan. Kami siap membantu!`;
  } catch (err) {
    console.error('Error generating brief:', err);
    return '❌ Gagal membuat brief, mohon coba lagi.';
  }
}

async function handleRegenerateBrief(content, message) {
  const match = content.match(/^regenerate brief \/ (.+)$/i);
  if (!match) return;

  const title = match[1].trim();
  
  // Cari task berdasarkan judul
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      property: 'Name',
      title: {
        equals: title
      }
    }
  });

  if (!response.results.length) {
    return await message.reply(`❌ Request dengan judul "${title}" tidak ditemukan`);
  }

  const task = response.results[0];
  const props = task.properties;
  const existingDescription = props.Description?.rich_text[0]?.plain_text || '';
  
  if (!existingDescription) {
    return await message.reply(`❌ Brief untuk "${title}" belum tersedia`);
  }

  // Kirim pesan "Brief sedang dibuat" setelah mendapatkan semua input
  await message.reply(`✍️ *Catatan tambahan untuk brief "${title}"*:\nSilakan masukkan catatan tambahan atau poin-poin yang perlu dimasukkan dalam brief. Jika tidak ada, ketik "skip".`);

  // Implementasi sederhana untuk menunggu balasan user
  let userInput = '';
  let inputReceived = false;
  
  // Fungsi untuk menangani balasan user
  const replyHandler = async (msg) => {
    if (msg.from === message.from && !inputReceived) {
      inputReceived = true;
      userInput = msg.body;
      
      client.off('message', replyHandler);
      
      if (userInput.toLowerCase() === "skip") {
        await message.reply("⏭️ Brief akan dibuat tanpa catatan tambahan.");
      }
      
      await message.reply(`🔄 Brief untuk tugas "${title}" sedang dibuat... Harap tunggu sebentar.`);

      const newDescription = `${existingDescription}\nCatatan tambahan: ${userInput !== "skip" ? userInput : ""}`;

      const newBrief = await generateBrief(title, newDescription);

      await message.reply(`${newBrief}`);

      await message.reply(`✨ *Brief telah berhasil diperbarui!* 🎨\n\nJika ada hal lain yang perlu diubah atau jika kamu ingin memperbarui brief lebih lanjut, cukup ketik *"regenerate brief / ${title}"* dan beri catatan tambahan. Kami siap membantu!`);
    }
  };

  client.on('message', replyHandler);

  setTimeout(async () => {
    if (!inputReceived) {
      inputReceived = true;
      client.off('message', replyHandler);
      await message.reply("⏭️ Waktu input habis, brief akan dibuat tanpa catatan tambahan.");
      
      await message.reply(`🔄 Brief untuk tugas "${title}" sedang dibuat... Harap tunggu sebentar.`);
      
      const newBrief = await generateBrief(title, existingDescription);

      await message.reply(`${newBrief}`);
    }
  }, 600000);
}

function getCurrentDate() {
  return new Date().toISOString().split('T')[0];
}

function getFormattedYear() {
  return `💫 ${new Date().getFullYear()}`;
}

function getFormattedMonth() {
  const monthNames = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];
  return `🔔 Client Request Creative ${monthNames[new Date().getMonth()]}`;
}

async function findOrCreateSubPage(parentId, title) {
  const { results } = await notion.blocks.children.list({ block_id: parentId, page_size: 50 });
  const existing = results.find(page => page.child_page?.title === title);
  if (existing) return existing.id;

  const newPage = await notion.pages.create({
    parent: { page_id: parentId },
    properties: {
      title: { title: [{ text: { content: title } }] }
    }
  });
  
  return newPage.id;
}

// ======== COMMAND HANDLERS ========
async function findExistingParent(databaseId, title) {
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Name',
      title: {
        equals: title
      }
    }
  });
  return response.results[0];
}

async function findOrCreateSubPage(parentId, title) {
  // First check if page already exists
  const existingPage = await findExistingParent(DATABASE_ID, title);
  if (existingPage) return existingPage;

  // If not exists, create new page
  return await notion.pages.create({
    parent: {
      type: 'database_id',
      database_id: DATABASE_ID
    },
    properties: {
      'Name': {
        title: [{ text: { content: title }}]
      },
      ...(parentId && {
        'Parent item': {
          relation: [{ id: parentId }]
        }
      })
    }
  });
}

async function handleAddTask(content, message) {
  // Improved extract function to handle multiline content better
  const extract = (field) => {
    const escapedField = field.replace(/([()])/g, '\\$1'); // escape () biar gak bikin regex error
    const patterns = [
      new RegExp(`${escapedField}\\s*:\\s*([^\\n]+)`, 'i'), // Field (desc): value
      new RegExp(`${field.split(' ')[0]}\\s*:\\s*([^\\n]+)`, 'i') // Simpler version: Field: value
    ];
  
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  };  

  const getFormattedYear = () => `💫 ${new Date().getFullYear()}`;
  const getFormattedMonth = () => `🔔 Client Request Creative ${new Date().toLocaleString('default', { month: 'long' })}`;
  const getCurrentDate = () => new Date().toISOString().split('T')[0];

  // Extract task data with improved field name handling
  const taskData = {
    title: extract('Judul'),
    dueDate: extract('Deadline (YYYY-MM-DD)'), 
    requester: extract('Requester (nama di Notion)'),
    week: extract('Weekly (Week 1-5)'),
    priority: extract('Priority (Low/Medium/High)'),
    description: extract('Description'),
    requestDate: getCurrentDate()
  };

  console.log('Extracted data:', taskData); // More comprehensive debug log

  // Improved date validation
  const validateDate = (dateStr) => {
    if (!dateStr) return false;
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) return false;
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  };

  // Validation with better error messages
  if (!taskData.title) return await message.reply('❌ Judul harus diisi');
  if (!taskData.dueDate || !validateDate(taskData.dueDate)) {
    return await message.reply('❌ Deadline harus diisi dengan format YYYY-MM-DD (contoh: 2025-12-31)');
  }
  if (!taskData.requester) return await message.reply('❌ Requester harus diisi');

  const normalizeWeek = (val) => {
    if (!val) return null;
  
    const match = val.match(/(?:week\s*)?([1-5])/i); 
    return match ? `Week ${match[1]}` : null;
  };  

  taskData.week = normalizeWeek(taskData.week);
  if (!taskData.week) {
    return await message.reply('❌ Weekly harus dalam format Week 1 sampai Week 5 (contoh: Week 3 atau 2)');
  }

  const normalizePriority = (priority) => {
    if (!priority) return null;
    const normalized = priority.toLowerCase();
    if (['low', 'medium', 'high'].includes(normalized)) {
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
    return null;
  };

  taskData.priority = normalizePriority(taskData.priority);
  if (!taskData.priority) {
    return await message.reply('❌ Priority harus Low, Medium, atau High');
  }

  if (!taskData.description) return await message.reply('❌ Description harus diisi');

  try {
    const requesterUser = await findUserByNameOrEmail(taskData.requester);
    if (!requesterUser) {
      return await message.reply(`❌ User "${taskData.requester}" tidak ditemukan di Notion`);
    }

    const yearPage = await findOrCreateSubPage(PARENT_PAGE_ID, getFormattedYear());
    const monthPage = await findOrCreateSubPage(yearPage.id, getFormattedMonth());
    const weekPage = await findOrCreateSubPage(monthPage.id, `🗓️ ${taskData.week}`);

    // Create the task with proper date formatting
    await notion.pages.create({
      parent: { database_id: DATABASE_ID },
      properties: {
        'Name': { 
          title: [{ 
            text: { content: taskData.title } 
          }] 
        },
        'Status WO': { status: { name: 'Open' } },
        'Status by Requester': { status: { name: 'Open' } },
        'Requester': { 
          people: [{ 
            object: 'user',
            id: requesterUser.id 
          }] 
        },
        'Request Date': { 
          date: { start: taskData.requestDate } 
        },
        'Due Date': { 
          date: { 
            start: taskData.dueDate,
          } 
        },
        'Tags': { select: { name: taskData.week } },
        'Priority': { select: { name: taskData.priority } },
        'Parent item': { relation: [{ id: weekPage.id }] },
        'Description': { 
          rich_text: [{ 
            text: { content: taskData.description } 
          }] 
        }
      }
    });

    await message.reply(`✅ Request "${taskData.title}" berhasil ditambahkan ke ${taskData.week}!`);
  } catch (err) {
    console.error('Error adding task:', err);
    await message.reply(`❌ Gagal menambahkan request: ${err.message}`);
  }
}


async function handleEditTask(content, message) {
  try {
    const title = content.split('/')[1]?.trim();
    if (!title) {
      return await message.reply('❌ Judul request harus diisi\nContoh: edit request / [Judul]');
    }

    // Find the task in Notion
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Name',
        title: {
          equals: title
        }
      }
    });

    if (response.results.length === 0) {
      return await message.reply('❌ Request tidak ditemukan');
    }

    const task = response.results[0];
    const props = task.properties;

    // Get requester name correctly
    let requesterName = '';
    if (props.Requester?.people && props.Requester.people.length > 0) {
      // Try both possible name fields (some APIs use different structures)
      requesterName = props.Requester.people[0].name || 
                     props.Requester.people[0].person?.name || 
                     props.Requester.people[0].person?.email || 
                     'Unknown';
    }

    const detail = `🛠️ *Edit Request to Creative* 🎨
_(silakan salin reply ini untuk edit request)_

*Detail Request* 
Judul : ${props.Name.title[0]?.plain_text || ''}
Deadline (YYYY-MM-DD): ${props['Due Date']?.date?.start || ''}
Requester (nama di Notion): ${requesterName}
Weekly (Week 1-5): ${props.Tags?.select?.name || ''}
Priority (Low/Medium/High): ${props.Priority?.select?.name || ''}
Description : ${props.Description?.rich_text[0]?.plain_text || ''}`;

    await message.reply(detail);
  } catch (err) {
    console.error('Error fetching task for edit:', err);
    await message.reply('❌ Gagal mengambil detail request untuk diedit.');
  }
}

async function handleUpdateTask(content, message) {
  try {
    // Fungsi bantu untuk ekstrak field dari pesan
    const escapeRegex = (str) => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    const extract = (field) => {
      // Mencocokkan dua pola:
      // 1. "Field: value" (format sederhana)
      // 2. "Field (description): value" (format dengan keterangan)
      const patterns = [
        new RegExp(`${field}\\s*\\([^)]*\\)\\s*:\\s*([^\n]+)`, 'i'), // Format dengan ()
        new RegExp(`${field}\\s*:\\s*([^\n]+)`, 'i') // Format sederhana
      ];
      
      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) return match[1].trim();
      }
      return null;
    };

    const title = extract('Judul');
    if (!title) {
      return await message.reply('❌ Judul harus diisi untuk update.');
    }

    // Cari task berdasarkan judul di database Notion
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Name',
        title: { equals: title }
      }
    });

    if (response.results.length === 0) {
      return await message.reply('❌ Request dengan judul tersebut tidak ditemukan.');
    }

    const taskId = response.results[0].id;

    // Fungsi normalisasi
    const normalize = {
      priority: (val) => {
        const valid = ['Low', 'Medium', 'High'];
        const match = valid.find(opt => opt.toLowerCase() === val?.toLowerCase());
        return match || null;
      },
      week: (val) => {
        const match = val?.trim().match(/^week\s*([1-5])$/i);
        return match ? `Week ${match[1]}` : null;
      }
    };

    // Proses requester
    const requesterName = extract('Requester');
    const requesterUser = requesterName ? findUserByNameOrEmail(requesterName) : null;

    if (requesterName && !requesterUser) {
      return await message.reply(`❌ User "${requesterName}" tidak ditemukan di Notion.`);
    }

    // Extract deadline and validate it
    const deadline = extract('Deadline');
    if (!deadline) {
      return await message.reply('❌ Deadline harus diisi (format: YYYY-MM-DD)');
    }

    // Siapkan field yang akan diupdate
    const updatedFields = {
      Name: { title: [{ text: { content: title } }] },
      'Due Date': { date: { start: deadline } }, // Use the extracted deadline directly
      ...(requesterUser && { Requester: { people: [{ id: requesterUser.id }] } }),
      Tags: {
        select: {
          name: normalize.week(extract('Weekly')) || 'Week 1'
        }
      },
      Priority: {
        select: {
          name: normalize.priority(extract('Priority')) || 'Medium'
        }
      },
      Description: {
        rich_text: [
          {
            text: {
              content: extract('Description') || ''
            }
          }
        ]
      }
    };

    // Kirim update ke Notion
    await notion.pages.update({
      page_id: taskId,
      properties: updatedFields
    });

    await message.reply(`✅ Request *${title}* berhasil diperbarui!`);
  } catch (err) {
    console.error('❌ Gagal update request:', err);
    await message.reply('❌ Terjadi kesalahan saat mengupdate request.');
  }
}

async function handleGenerateBrief(content, message) {
  try {

    // Ekstrak judul dari format "generate brief / JudulRequest"
    const titleMatch = content.match(/generate brief\s*\/\s*(.+)/i);
    if (!titleMatch) {
      return await message.reply('❌ Format salah. Gunakan: generate brief / JudulRequest');
    }

    const title = titleMatch[1].trim();

    // Cari task berdasarkan judul di Notion
    const searchResponse = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Name',
        title: {
          equals: title
        }
      }
    });

    if (!searchResponse.results.length) {
      return await message.reply(`❌ Request dengan judul "${title}" tidak ditemukan di Notion`);
    }

    const task = searchResponse.results[0];
    const pageId = task.id;

    // Ambil deskripsi
    const descriptionProperty = task.properties['Description'];
    if (!descriptionProperty || !descriptionProperty.rich_text.length) {
      return await message.reply('❌ Deskripsi tidak ditemukan atau masih kosong di request tersebut');
    }
    const description = descriptionProperty.rich_text.map(text => text.text.content).join(' ');

    // Generate brief
    const brief = await generateBrief(title, description);

    // Update properti "Brief" di halaman Notion
    await notion.pages.update({
      page_id: pageId,
      properties: {
        Brief: {
          rich_text: [{
            text: {
              content: brief
            }
          }]
        }
      }
    });

    // Kirim ke WhatsApp
    await message.reply(`📝 *Brief untuk "${title}"* berhasil digenerate dan disimpan ke Notion:\n\n${brief}`);
  } catch (err) {
    console.error('Error generating brief:', err);
    await message.reply('❌ Gagal membuat brief. Silakan coba lagi.');
  }
}

// ======== UPDATE REQUEST HANDLERS ========
function isActualTask(task) {
  const title = task.properties.Name?.title?.[0]?.plain_text || '';
  const status = task.properties['Status WO']?.status?.name || '';
  
  // Exclude common container page titles and templates
  const excludedPatterns = [
    /^Week\s\d+/i,
    /^Client Request/i,
    /^\d{4}$/, // Years like "2025"
    /^🗓️/i,
    /^🔔/i,
    /^💫/i,
    /Template/i
  ];
  
  return (
    title && 
    !excludedPatterns.some(pattern => pattern.test(title)) &&
    status !== 'Template'
  );
}

async function handleUpdateToInProgress(content, message) {
  try {
    let title, picCreative;
    
    // Check for both formats
    if (content.includes('Judul :') || content.includes('PIC Creative :')) {
      // Detailed format processing
      const extractField = (fieldName) => {
        const regex = new RegExp(`${fieldName} : (.+)`);
        const match = content.match(regex);
        return match ? match[1].trim() : null;
      };

      title = extractField('Judul') || extractField('Judul');
      picCreative = extractField('PIC Creative');
    } else if (content.includes('/')) {
      // Simplified format processing
      const parts = content.split('/').map(part => part.trim());
      if (parts.length < 3) {
        return await message.reply('❌ Format salah. Gunakan: update to In Progress / JudulRequest / PIC Creative');
      }
      title = parts[1];
      picCreative = parts[2];
    } else {
      return await message.reply('❌ Format tidak dikenali. Gunakan format lengkap atau singkat');
    }

    if (!title) return await message.reply('❌ Judul harus diisi');
    if (!picCreative) return await message.reply('❌ PIC Creative harus diisi');

    // Refresh user cache first to ensure we have latest data
    await refreshUserCache();

    // Find the task in Notion (case insensitive)
    const allTasks = await notion.databases.query({ 
      database_id: DATABASE_ID,
      page_size: 100
    });
    
    const task = allTasks.results.find(t => 
      t.properties.Name.title[0]?.plain_text?.toLowerCase() === title.toLowerCase()
    );

    if (!task) {
      return await message.reply(`❌ Request "${title}" tidak ditemukan. Pastikan judul sama dengan di Notion`);
    }

    // Find user in Notion (case insensitive)
    const user = NOTION_USERS_CACHE.find(u => 
      u.name?.toLowerCase() === picCreative.toLowerCase() || 
      u.person?.email?.toLowerCase() === picCreative.toLowerCase()
    );

    if (!user) {
      return await message.reply(`❌ User "${picCreative}" tidak ditemukan di Notion. Berikut user yang tersedia:\n${
        NOTION_USERS_CACHE.map(u => `- ${u.name || u.person?.email}`).join('\n')
      }`);
    }

    // Update the task
    await notion.pages.update({
      page_id: task.id,
      properties: {
        'PIC Creative': {
          people: [{ id: user.id }]
        },
        'Status WO': {
          status: { name: 'In Progress' }
        },
        'Status by Requester': {
          status: { name: 'In Progress' }
        }
      }
    });

    await message.reply(`✅ Request *"${title}"* berhasil diupdate ke In Progress dengan PIC *${user.name}*`);
  } catch (err) {
    console.error('Error updating to In Progress:', err);
    await message.reply('❌ Gagal mengupdate request. Silakan coba lagi atau hubungi developer.');
  }
}

async function handleUpdateToWaitingCheck(content, message) {
  try {
    let title, evidence;

    const match = content.match(/^update to waiting check\s*\/\s*(.+?)\s*\/\s*(https?:\/\/\S+)$/i);
    if (match) {
      title = match[1].trim();
      evidence = match[2].trim();
    }

    if (!title) return await message.reply('❌ Judul harus diisi (format: update to waiting check / JudulRequest / Evidence URL)');
    if (!evidence) return await message.reply('❌ Evidence harus diisi (URL)');

    // Validasi URL
    try {
      new URL(evidence);
    } catch (_) {
      return await message.reply('❌ Format URL tidak valid. Harus dimulai dengan http:// atau https://');
    }

    // Cari task di Notion (case-insensitive)
    const allTasks = await notion.databases.query({ 
      database_id: DATABASE_ID,
      page_size: 100
    });

    const task = allTasks.results.find(t => 
      t.properties.Name.title[0]?.plain_text?.toLowerCase() === title.toLowerCase()
    );

    if (!task) {
      return await message.reply(`❌ Request "${title}" tidak ditemukan. Cek:\n1. Judul harus sama persis\n2. Request harus dalam status 'In Progress'`);
    }

    // Update task
    await notion.pages.update({
      page_id: task.id,
      properties: {
        'Files & media': {
          files: [{ name: 'Evidence', external: { url: evidence } }]
        },
        'Status WO': {
          status: { name: 'Done' }
        },
        'Status by Requester': {
          status: { name: 'Waiting Check' }
        }
      }
    });

    await message.reply(`✅ Request *"${title}"* berhasil diupdate ke *Waiting Check*\n\n📎 Evidence: ${evidence}`);
  } catch (err) {
    console.error('Error updating to Waiting Check:', err);
    await message.reply('❌ Gagal mengupdate request. Pastikan:\n1. Format sesuai contoh\n2. URL evidence valid\n3. Request sudah In Progress');
  }
}

async function handleUpdateToDone(content, message) {
  try {
    let title;
    
    // Check for simplified format
    if (content.includes('/')) {
      const parts = content.split('/').map(part => part.trim());
      if (parts.length < 2) {
        return await message.reply('❌ Format salah. Gunakan: update to Done / JudulRequester');
      }
      title = parts[1];
    } else {
      // Extract from detailed format
      const extract = (field) => {
        const lines = content.split('\n');
        for (const line of lines) {
          if (line.includes(field)) {
            const parts = line.split(':');
            if (parts.length > 1) {
              return parts.slice(1).join(':').trim();
            }
          }
        }
        return null;
      };

      title = extract('Judul');
    }

    if (!title) return await message.reply('❌ Judul harus diisi');

    // Find the task in Notion
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Name',
        title: {
          equals: title
        }
      }
    });

    if (response.results.length === 0) {
      return await message.reply('❌ Request tidak ditemukan');
    }

    const task = response.results[0];

    // Update the task
    await notion.pages.update({
      page_id: task.id,
      properties: {
        'Status by Requester': {
          status: { name: 'Done' }
        }
      }
    });

    await message.reply(`✅ Request *"${title}"* berhasil diupdate ke Done`);
  } catch (err) {
    console.error('Error updating to Done:', err);
    await message.reply('❌ Gagal mengupdate request. Silakan coba lagi.');
  }
}

// ======== TASK LISTING HANDLERS ========

async function findSubPageOnly(parentId, pageName) {
  const response = await notion.search({
    query: pageName,
    filter: {
      value: 'page',
      property: 'object'
    },
    sort: {
      direction: 'ascending',
      timestamp: 'last_edited_time'
    }
  });

  return response.results.find((page) => {
    const isChild = !parentId || page.parent?.page_id === parentId;
    const titleProperty = Object.values(page.properties || {}).find(prop => prop.type === 'title');
    const titleText = titleProperty?.title?.[0]?.plain_text;

    return isChild && titleText === pageName;
  });
}



async function handleListTasksByPriority(content, message) {
  const getFormattedYear = () => `💫 ${new Date().getFullYear()}`;
  const getFormattedMonth = () => `🔔 Client Request Creative ${new Date().toLocaleString('default', { month: 'long' })}`;

  try {
    const parts = content.split('/').map(p => p.trim().toLowerCase());
    const priorityInput = parts[1];
    const weekInput = parts[2];

    // Validasi dan normalisasi Priority
    const priorityMap = {
      'low': 'Low',
      'medium': 'Medium',
      'high': 'High'
    };

    const normalizedPriority = priorityMap[priorityInput];
    if (!normalizedPriority) {
      return await message.reply(
        '❌ Priority harus Low, Medium, atau High\n' +
        'Contoh: list request by priority / Medium / Week 2\n' +
        '(Penulisan priority tidak case sensitive)'
      );
    }

    // Validasi dan normalisasi Week
    const weekMatch = weekInput?.match(/^week\s*([1-5])$/i) || weekInput?.match(/^([1-5])$/);
    if (!weekMatch) {
      return await message.reply(
        '❌ Week harus dalam format "Week X" atau angka 1-5\n' +
        'Contoh:\n' +
        'list request by priority / Medium / Week 2\n' +
        'atau\n' +
        'list request by priority / High / 3'
      );
    }

    const week = `Week ${weekMatch[1]}`;
    const weekName = `🗓️ ${week}`;
    const yearName = getFormattedYear();
    const monthName = getFormattedMonth();

    const yearPage = await findSubPageOnly(null, yearName);
    if (!yearPage) return await message.reply(`❌ Gagal menemukan folder tahun ${new Date().getFullYear()}`);

    const monthPage = await findSubPageOnly(null, monthName);
    if (!monthPage) return await message.reply(`❌ Gagal menemukan folder bulan ini`);

    const weekPage = await findSubPageOnly(null, weekName);
    if (!weekPage) return await message.reply(`❌ Gagal menemukan folder ${week}`);

    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Priority',
            select: {
              equals: normalizedPriority
            }
          },
          {
            property: 'Parent item',
            relation: {
              contains: weekPage.id
            }
          }
        ]
      },
      sorts: [
        {
          property: 'Due Date',
          direction: 'ascending'
        }
      ]
    });

    if (!response.results.length) {
      return await message.reply(`🔍 Tidak ada request dengan priority *${normalizedPriority}* di *${week}*`);
    }

    await sendTaskList(message, response.results, `*Request Priority ${normalizedPriority} - ${week}*`);
  } catch (err) {
    console.error('Error listing request by priority:', err);
    await message.reply('❌ Gagal mengambil daftar request');
  }
}

async function handleListTasksByDeadline(content, message) {
  const getFormattedYear = () => `💫 ${new Date().getFullYear()}`;
  const getFormattedMonth = () => `🔔 Client Request Creative ${new Date().toLocaleString('default', { month: 'long' })}`;

  try {
    const parts = content.split('/').map(p => p.trim().toLowerCase());
    const weekInput = parts[1];

    // Normalisasi input minggu
    const match = weekInput?.match(/^week\s*([1-5])$/i) || weekInput?.match(/^([1-5])$/);
    if (!match) {
      return await message.reply('❌ Weekly harus Week 1 sampai Week 5\nContoh: list request by deadline / Week 2');
    }

    const week = `Week ${match[1]}`;
    const weekName = `🗓️ ${week}`;
    const yearName = getFormattedYear();
    const monthName = getFormattedMonth();

    const yearPage = await findSubPageOnly(null, yearName);
    if (!yearPage) return await message.reply(`❌ Gagal menemukan folder tahun ${new Date().getFullYear()}`);

    const monthPage = await findSubPageOnly(null, monthName);
    if (!monthPage) return await message.reply(`❌ Gagal menemukan folder bulan ini`);

    const weekPage = await findSubPageOnly(null, weekName);
    if (!weekPage) return await message.reply(`❌ Gagal menemukan folder ${week}`);

    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Due Date',
            date: {
              is_not_empty: true
            }
          },
          {
            property: 'Status WO',
            status: {
              is_not_empty: true
            }
          },
          {
            property: 'Parent item',
            relation: {
              contains: weekPage.id
            }
          }
        ]
      },
      sorts: [
        {
          property: 'Due Date',
          direction: 'ascending'
        }
      ],
      page_size: 100
    });

    const actualTasks = typeof isActualTask === 'function'
      ? response.results.filter(isActualTask)
      : response.results;

    if (!actualTasks.length) {
      return await message.reply(`🔍 Tidak ada request dengan *Deadline* di *${week}*`);
    }

    await sendTaskList(message, actualTasks, `*Request Deadline - ${week}*`);
  } catch (err) {
    console.error('Error listing tasks by deadline:', err);
    await message.reply('❌ Gagal mengambil daftar request');
  }
}

async function handleListTasksByPIC(content, message) {
  const getFormattedYear = () => `💫 ${new Date().getFullYear()}`;
  const getFormattedMonth = () => `🔔 Client Request Creative ${new Date().toLocaleString('default', { month: 'long' })}`;

  try {
    const parts = content.split('/').map(p => p.trim());
    
    // Validasi jumlah bagian input
    if (parts.length < 3) {
      return await message.reply('❌ Format salah. Gunakan:\nlist request by PIC Creative / nama PIC / Week 2');
    }

    const picName = parts[1];
    const weekInput = parts[2].toLowerCase();

    // Normalisasi week
    const weekMatch = weekInput.match(/^week\s*([1-5])$/i) || weekInput.match(/^([1-5])$/);
    if (!weekMatch) {
      return await message.reply('❌ Weekly harus dari Week 1 sampai Week 5\nContoh: list request by PIC Creative / nama PIC / Week 2');
    }
    const week = `Week ${weekMatch[1]}`;
    const weekName = `🗓️ ${week}`;

    // Cari user dari cache
    await refreshUserCache();
    const user = findUserByNameOrEmail(picName);
    if (!user) {
      return await message.reply(`❌ User "${picName}" tidak ditemukan`);
    }

    const yearName = getFormattedYear();
    const monthName = getFormattedMonth();

    const yearPage = await findSubPageOnly(null, yearName);
    if (!yearPage) return await message.reply(`❌ Gagal menemukan folder tahun ${new Date().getFullYear()}`);

    const monthPage = await findSubPageOnly(null, monthName);
    if (!monthPage) return await message.reply(`❌ Gagal menemukan folder bulan ini`);

    const weekPage = await findSubPageOnly(null, weekName);
    if (!weekPage) return await message.reply(`❌ Gagal menemukan folder ${week}`);

    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            property: 'PIC Creative',
            people: {
              contains: user.id
            }
          },
          {
            property: 'Parent item',
            relation: {
              contains: weekPage.id
            }
          }
        ]
      },
      sorts: [{
        property: 'Due Date',
        direction: 'ascending'
      }]
    });

    if (!response.results.length) {
      return await message.reply(`🔍 Tidak ada request untuk *${user.name}* di *${week}*`);
    }

    await sendTaskList(message, response.results, `*Request untuk PIC ${user.name} - ${week}*`);
  } catch (err) {
    console.error('Error listing request by PIC:', err);
    await message.reply('❌ Gagal mengambil daftar request');
  }
}

async function handleListTasksByStatus(content, message) {
  const getFormattedYear = () => `💫 ${new Date().getFullYear()}`;
  const getFormattedMonth = () => `🔔 Client Request Creative ${new Date().toLocaleString('default', { month: 'long' })}`;

  try {
    // Pisahkan input berdasarkan '/'
    const parts = content.split('/').map(p => p.trim());

    // Validasi panjang input
    if (parts.length < 3) {
      return await message.reply('❌ Format salah. Contoh:\nlist request by status / Open / Week 2');
    }

    const statusInput = parts[1]?.toLowerCase().replace(/\s+/g, ' ').trim();
    const weekInput = parts[2]?.toLowerCase().trim();

    // Validasi dan normalisasi week
    const weekMatch = weekInput.match(/^week\s*([1-5])$/i) || weekInput.match(/^([1-5])$/);
    if (!weekMatch) {
      return await message.reply('❌ Weekly harus "Week 1" sampai "Week 5"\nContoh: list request by status / Open / Week 2');
    }
    const week = `Week ${weekMatch[1]}`;

    // Daftar status yang diizinkan
    const allowedStatuses = {
      'open': 'Open',
      'in progress': 'In Progress',
      'inprogress': 'In Progress',
      'done': 'Done',
      'waiting check': 'Waiting Check',
      'waitingcheck': 'Waiting Check'
    };

    const status = allowedStatuses[statusInput];
    if (!status) {
      return await message.reply('❌ Status harus Open, In Progress, Done, atau Waiting Check\nContoh: list request by status / Open / Week 2');
    }

    const yearName = getFormattedYear();
    const monthName = getFormattedMonth();

    const yearPage = await findSubPageOnly(null, yearName);
    if (!yearPage) return await message.reply(`❌ Gagal menemukan folder tahun ${new Date().getFullYear()}`);

    const monthPage = await findSubPageOnly(null, monthName);
    if (!monthPage) return await message.reply(`❌ Gagal menemukan folder bulan ini`);

    const weekPage = await findSubPageOnly(null, `🗓️ ${week}`);
    if (!weekPage) return await message.reply(`❌ Gagal menemukan folder ${week}`);

    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Status WO',
            status: {
              equals: status
            }
          },
          {
            property: 'Parent item',
            relation: {
              contains: weekPage.id
            }
          }
        ]
      },
      sorts: [{
        property: 'Due Date',
        direction: 'ascending'
      }]
    });

    if (!response.results.length) {
      return await message.reply(`🔍 Tidak ada request dengan status *${status}* di *${week}*`);
    }

    await sendTaskList(message, response.results, `*Request dengan Status ${status} - ${week}*`);
  } catch (err) {
    console.error('Error listing request by status:', err);
    await message.reply('❌ Gagal mengambil daftar request');
  }
}


async function handleListTasksByStatusReq(content, message) {
  const getFormattedYear = () => `💫 ${new Date().getFullYear()}`;
  const getFormattedMonth = () => `🔔 Client Request Creative ${new Date().toLocaleString('default', { month: 'long' })}`;

  try {
    // Pisahkan input berdasarkan '/'
    const parts = content.split('/').map(p => p.trim());

    // Cek apakah ada cukup bagian
    if (parts.length < 3) {
      return await message.reply('❌ Format salah. Contoh benar:\nlist request by status by requester / Open / Week 2');
    }

    const statusInput = parts[1]?.toLowerCase().replace(/\s+/g, ' ').trim();
    const weekInput = parts[2]?.toLowerCase().trim();

    // Konversi week
    const weekMatch = weekInput.match(/^week\s*([1-5])$/i) || weekInput.match(/^([1-5])$/);
    if (!weekMatch) {
      return await message.reply('❌ Weekly harus dalam format "Week 1" sampai "Week 5"\nContoh: / Week 2 atau / 3');
    }
    const week = `Week ${weekMatch[1]}`;

    // Daftar status yang diizinkan
    const allowedStatuses = {
      'open': 'Open',
      'in progress': 'In Progress',
      'inprogress': 'In Progress',
      'done': 'Done',
      'waiting check': 'Waiting Check',
      'waitingcheck': 'Waiting Check'
    };

    const status = allowedStatuses[statusInput];
    if (!status) {
      return await message.reply('❌ Status harus Open, In Progress, Done, atau Waiting Check\nContoh: list request by status by requester / Open / Week 2');
    }

    const yearName = getFormattedYear();
    const monthName = getFormattedMonth();

    const yearPage = await findSubPageOnly(null, yearName);
    if (!yearPage) return await message.reply(`❌ Gagal menemukan folder tahun ${new Date().getFullYear()}`);

    const monthPage = await findSubPageOnly(null, monthName);
    if (!monthPage) return await message.reply(`❌ Gagal menemukan folder bulan ini`);

    const weekPage = await findSubPageOnly(null, `🗓️ ${week}`);
    if (!weekPage) return await message.reply(`❌ Gagal menemukan folder ${week}`);

    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Status by Requester',
            status: {
              equals: status
            }
          },
          {
            property: 'Parent item',
            relation: {
              contains: weekPage.id
            }
          }
        ]
      },
      sorts: [{
        property: 'Due Date',
        direction: 'ascending'
      }]
    });

    if (!response.results.length) {
      return await message.reply(`🔍 Tidak ada request dengan status *${status}* di *${week}*`);
    }

    await sendTaskList(message, response.results, `*Request dengan Status ${status} - ${week}*`);
  } catch (err) {
    console.error('Error listing request by status:', err);
    await message.reply('❌ Gagal mengambil daftar request');
  }
}


async function handleListAllTasks(content, message) {
  const getFormattedYear = () => `💫 ${new Date().getFullYear()}`;
  const getFormattedMonth = () => `🔔 Client Request Creative ${new Date().toLocaleString('default', { month: 'long' })}`;

  try {
    const rawWeek = content.split('/')[1]?.trim().toLowerCase();
    const match = rawWeek?.match(/^week\s*([1-5])$/i);
  
    if (!match) {
      return await message.reply('❌ Weekly harus Week 1 sampai Week 5\nContoh: Week 1');
    }
  
    const week = `Week ${match[1]}`;

    const yearName = getFormattedYear();
    const monthName = getFormattedMonth();

    const yearPage = await findSubPageOnly(null, yearName);
    if (!yearPage) return await message.reply(`❌ Gagal menemukan folder tahun ${new Date().getFullYear()}`);

    const monthPage = await findSubPageOnly(null, monthName);
    if (!monthPage) return await message.reply(`❌ Gagal menemukan folder bulan ini`);

    const weekPage = await findSubPageOnly(null, `🗓️ ${week}`);
    if (!weekPage) return await message.reply(`❌ Gagal menemukan folder ${week}`);

    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Status WO',
            status: {
              is_not_empty: true
            }
          },
          {
            property: 'Parent item',
            relation: {
              contains: weekPage.id
            }
          }
        ]
      },
      sorts: [
        {
          property: 'Due Date',
          direction: 'ascending'
        }
      ],
      page_size: 100
    });

    const actualTasks = typeof isActualTask === 'function'
    ? response.results.filter(isActualTask)
    : response.results;

    await sendTaskList(message, actualTasks, `*Semua Request ${week}*`);
  } catch (err) {
    console.error('Error listing all tasks:', err);
    await message.reply('❌ Gagal mengambil daftar request');
  }
}

async function handleTaskDetail(content, message) {
  try {
    const title = content.split('/')[1]?.trim();
    if (!title) {
      return await message.reply('❌ Judul request harus diisi\nContoh: see detail request / Desain Feed Instagram');
    }

    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Name',
        title: {
          equals: title
        }
      }
    });

    if (response.results.length === 0) {
      return await message.reply('❌ Request tidak ditemukan');
    }

    const task = response.results[0];
    await sendTaskDetail(message, task);
  } catch (err) {
    console.error('Error getting request detail:', err);
    await message.reply('❌ Gagal mengambil detail request');
  }
}

// Helper function to format task list
async function sendTaskList(message, tasks, title) {
  if (tasks.length === 0) {
    return await message.reply(`📭 Tidak ada request yang ditemukan`);
  }

  let taskList = `📝 ${title} (${tasks.length} request)\n\n`; // Title awal

  tasks.forEach((task, index) => {
    const props = task.properties;

    taskList += `*${index + 1}. ${props.Name.title[0]?.plain_text || 'No Title'}*\n`;
    taskList += `➤ Status: ${props['Status WO']?.status?.name || '-'}\n`;
    taskList += `➤ PIC Creative: ${props['PIC Creative']?.people[0]?.name || '-'}\n`;
    taskList += `➤ Deadline: ${props['Due Date']?.date?.start || '-'}\n`;
    taskList += `➤ Priority: ${props.Priority?.select?.name || '-'}`;

    // Tambahkan newline antar task
    if (index < tasks.length - 1) {
      taskList += `\n\n`;
    }
  });

  // Tambahan di akhir
  taskList += `\n\n✨ Thank you!`;

  await message.reply(taskList);
}


// Helper function to format task detail
async function sendTaskDetail(message, task) {
  const props = task.properties;
  let detail = `📝 *Detail Request*\n\n`;
  detail += `- Judul: ${props.Name.title[0]?.plain_text || '-'}\n`;
  detail += `- Status WO: ${props['Status WO']?.status?.name || '-'}\n`;
  detail += `- Status by Requester: ${props['Status by Requester']?.status?.name || '-'}\n`;
  detail += `- Requester: ${props.Requester?.people[0]?.name || '-'}\n`;
  detail += `- PIC Creative: ${props['PIC Creative']?.people[0]?.name || '-'}\n`;
  detail += `- Request Date: ${props['Request Date']?.date?.start || '-'}\n`;
  detail += `- Due Date: ${props['Due Date']?.date?.start || '-'}\n`;
  detail += `- Priority: ${props.Priority?.select?.name || '-'}\n`;
  detail += `- Weekly: ${props.Tags?.select?.name || '-'}\n`;

  // Description
  const description = props.Description?.rich_text?.map(text => text.text.content).join(' ') || '-';
  detail += `- Description: ${description}\n`;

  // Brief
  let brief = '-';
  if (props.Brief?.rich_text?.length > 0) {
    brief = props.Brief.rich_text.map(text => text.text.content).join(' ');
  } else {
    brief = '(Brief belum digenerate)';
  }
  detail += `- Brief: ${brief}\n`;

  // Evidence
  if (props['Files & media']?.files?.length > 0) {
    const evidenceLinks = props['Files & media'].files
      .map(file => file.external?.url || file.file?.url)
      .filter(Boolean)
      .join('\n');
    detail += `\n📁 *Evidence:*\n${evidenceLinks}\n`;
  }

  await message.reply(detail);
}

// ======== WHATSAPP EVENT HANDLERS ========
const express = require('express');
const qrcode = require('qrcode');
const app = express();
let latestQR = '';

// Mendapatkan QR code dari WhatsApp
client.on('qr', async qr => {
  console.log('📷 QR code received! Visit /qr to scan.');
  latestQR = qr;
});

// Endpoint untuk QR code
app.get('/qr', async (req, res) => {
  if (!latestQR) return res.send('No QR code yet.');
  const qrImage = await qrcode.toDataURL(latestQR);
  res.send(`
    <html>
      <body style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;">
        <h2>Scan this QR code with WhatsApp</h2>
        <img src="${qrImage}" />
      </body>
    </html>
  `);
});

// Menjalankan server Express di port 3000
app.listen(3000, () => {
  console.log('🔗 Visit https://chatbot-creative-production-d44b.up.railway.app/qr to scan qr code');
});


client.on('ready', () => {
  console.log('🤖 Bot ready!');
  refreshUserCache();
  setInterval(refreshUserCache, 3600000);
});

client.on('message', async (message) => {
  try {
    let content = message.body;

    // Handle group mentions
    if (message.from.endsWith('@g.us')) {
      const botNumber = `${client.info.wid.user}@c.us`;
      if (!message.mentionedIds?.includes(botNumber)) return;
      content = content.replace(/@\d+/g, '').trim();
    }

    // Command routing
    if (/^prompt add request/i.test(content)){
      const promptText = `📝 *Creative Request Form* 🎨
(copy reply ini untuk kirim request)

Judul: 
Deadline (YYYY-MM-DD): 
Requester (nama di Notion):
Weekly (Week 1-5): 
Priority (Low/Medium/High):
Description: 

*Notes Penulisan*
(tambahkan tag @mention bot pada baris pertama)`;
      await message.reply(promptText);
    }
    else if (/^prompt update to In Progress/i.test(content)) {
      const promptText = `🛠️ *Update Request to In Progress* 🧑🏻‍💻
_(silakan salin reply ini untuk update request to In Progress)_

*Detail Request* 
Judul : 
PIC Creative :
      
*Notes penulisan*  
- Pastikan judul request ada dan sesuai pada list all request
- Nama PIC Creative sesuaikan dengan nama pengguna di notion`;
      await message.reply(promptText);
    }
    else if (/^prompt update to Waiting Check/i.test(content)) {
      const promptText = `🛠️ *Update Request to Waiting Check* ⏳
_(silakan salin reply ini untuk update request to Waiting Check)_

*Detail Request* 
Judul : 
Evidence :
      
*Notes penulisan*  
- Pastikan judul request ada dan sesuai pada list all request
- Evidence harus berupa URL yang valid`;
      await message.reply(promptText);
    }
    else if (/^prompt update to Done/i.test(content)) {
      const promptText = `🛠️ *Update Request to Done* ✅
_(silakan salin reply ini untuk update request to Done)_

*Detail Request* 
Judul : 
      
*Notes penulisan*  
- Pastikan judul request ada dan sesuai pada list all request`;
      await message.reply(promptText);
    }
    else if (content.includes('*Edit Request to Creative*')) {
      await handleUpdateTask(content, message);
    }  
    else if (content.includes('Judul:') && content.includes('Weekly (Week 1-5):')) {
      await handleAddTask(content, message);
    }  
    else if (content.startsWith('generate brief /')) {
      await handleGenerateBrief(content, message);
    }
    else if (content.startsWith('regenerate brief /')) {
      await handleRegenerateBrief(content, message);
    }
    else if (content.startsWith('edit request /')) {
      await handleEditTask(content, message);
    }
    else if (content.includes('Judul :') && content.includes('PIC Creative :')) {
      await handleUpdateToInProgress(content, message);
    }
    else if (content.includes('Judul :') && content.includes('Evidence :')) {
      await handleUpdateToWaitingCheck(content, message);
    }
    else if (content.includes('Judul :') && !content.includes('Evidence :') && !content.includes('PIC Creative :')) {
      await handleUpdateToDone(content, message);
    }
    else if (/^update to In Progress\s*\//i.test(content)) {
      await handleUpdateToInProgress(content, message);
    }
    else if (/^update to Waiting Check\s*\//i.test(content)) {
      await handleUpdateToWaitingCheck(content, message);
    }
    else if (/^update to Done\s*\//i.test(content)) {
      await handleUpdateToDone(content, message);
    }
    else if (/^list by priority\s*\//i.test(content)) {
      await handleListTasksByPriority(content, message);
    }
    else if (/^list by deadline\s*\//i.test(content)) {
      await handleListTasksByDeadline(content, message);
    }
    else if (/^list by PIC Creative\s*\//i.test(content)) {
      await handleListTasksByPIC(content, message);
    }
    else if (/^list by Status WO\s*\//i.test(content)) {
      await handleListTasksByStatus(content, message);
    }
    else if (/^list by status requester\s*\//i.test(content)) {
      await handleListTasksByStatusReq(content, message);
    }
    else if (/^list all\s*\//i.test(content)) {
      await handleListAllTasks(content, message);
    }
    else if (/^see detail\s*\//i.test(content)) {
      await handleTaskDetail(content, message);
    }
    else if (content === 'help') {
      const helpText = `
🤖 *BOT CREATIVE by GOODEVA* 💫
    
📌 *Request Management Commands:*
- prompt add request 
- prompt update to In Progress 
- prompt update to Waiting Check 
- prompt update to Done 
    
📌 *Request Listing Commands:*
- list by priority / [Low|Medium|High] / [Week 1-5]
- list by deadline / [Week 1-5]
- list by PIC Creative / [nama] 
- list by Status WO / [Open|In Progress|Waiting Check|Done] / [Week 1-5]
- list all / [Week 1-5]
- see detail / [judul] 
    
📌 *Quick Commands:*
- update to In Progress / [judul] / [PIC]
- updateto Waiting Check / [judul] / [evidence URL]
- update to Done / [judul]
- generate brief / [Judul]
- regenerate brief / [Judul]
- edit request / [Judul]
`;
      await message.reply(helpText);
    }
  } catch (err) {
    console.error('Error:', err);
    await message.reply('❌ Terjadi kesalahan saat memproses perintah');
  }
});

// ======== START BOT ========
console.log('⏳ Starting bot...');
client.initialize();
