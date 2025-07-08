const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Optional dependencies
let Dropbox, fetch, TeraboxUploader;
try {
  Dropbox = require('dropbox').Dropbox;
  fetch = require('isomorphic-fetch');
} catch {}
try {
  TeraboxUploader = require('terabox-upload-tool');
} catch {}

const app = express();
const upload = multer({ dest: 'uploads/' });

// Serve static files (HTML, JS, CSS) from /public
app.use(express.static(path.join(__dirname, 'public')));

// Serve user-uploaded files from /uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Dropbox setup
const dropboxAccessToken = process.env.DROPBOX_ACCESS_TOKEN || '';
const dbx = Dropbox && dropboxAccessToken
  ? new Dropbox({ accessToken: dropboxAccessToken, fetch })
  : null;

// Terabox setup
const teraboxCreds = {
  ndus: process.env.TERABOX_NDUS || '',
  appId: process.env.TERABOX_APPID || '',
  uploadId: process.env.TERABOX_UPLOADID || '',
  jsToken: process.env.TERABOX_JSTOKEN || '',
  browserId: process.env.TERABOX_BROWSERID || '',
};
let teraboxUploader = null;
if (
  TeraboxUploader &&
  teraboxCreds.ndus &&
  teraboxCreds.appId &&
  teraboxCreds.uploadId &&
  teraboxCreds.jsToken &&
  teraboxCreds.browserId
) {
  try {
    teraboxUploader = new TeraboxUploader(teraboxCreds);
  } catch (e) {
    console.error('TeraBox credentials missing or invalid:', e.message);
  }
}

// (Optional) Placeholder for media.nz
async function uploadToMediaNz(filePath, fileName) {
  return { success: false, message: 'media.nz upload not implemented yet' };
}

// Serve main HTML at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'GitRenderFileManager.html'));
});

// Health check endpoint (optional, good for Render)
app.get('/healthz', (req, res) => res.send('OK'));

// Upload endpoint
app.post('/upload', upload.array('files'), async (req, res) => {
  const provider = req.body.provider;
  const files = req.files || [];
  let links = [];

  if (provider === 'local') {
    links = files.map(f => ({
      name: f.originalname,
      url: `/uploads/${f.filename}`
    }));
    res.json({ message: 'Uploaded to temporary storage.', links });
  } else if (provider === 'dropbox') {
    if (!dbx) return res.status(500).json({ message: 'Dropbox not configured.' });
    for (let f of files) {
      try {
        const content = fs.readFileSync(f.path);
        await dbx.filesUpload({ path: '/' + f.originalname, contents: content });
        const sharedLinkRes = await dbx.sharingCreateSharedLinkWithSettings({ path: '/' + f.originalname });
        let url = sharedLinkRes.result.url;
        url = url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', '');
        links.push({ name: f.originalname, url });
      } catch (e) {
        links.push({ name: f.originalname, url: '', error: e.message });
      }
      fs.unlinkSync(f.path);
    }
    res.json({ message: 'Uploaded to Dropbox.', links });
  } else if (provider === 'terabox') {
    if (!teraboxUploader) return res.status(500).json({ message: 'TeraBox not configured.' });
    for (let f of files) {
      try {
        const result = await teraboxUploader.uploadFile(f.path, null, '/filemanager-uploads');
        if (result.success && result.fileDetails && result.fileDetails.downloadLink) {
          links.push({ name: f.originalname, url: result.fileDetails.downloadLink });
        } else {
          links.push({ name: f.originalname, url: '', error: result.message || 'Upload failed' });
        }
      } catch (e) {
        links.push({ name: f.originalname, url: '', error: e.message });
      }
      fs.unlinkSync(f.path);
    }
    res.json({ message: 'Uploaded to TeraBox.', links });
  } else if (provider === 'medianz') {
    for (let f of files) {
      try {
        const result = await uploadToMediaNz(f.path, f.originalname);
        if (result.success) {
          links.push({ name: f.originalname, url: result.url });
        } else {
          links.push({ name: f.originalname, url: '', error: result.message || 'Upload failed' });
        }
      } catch (e) {
        links.push({ name: f.originalname, url: '', error: e.message });
      }
      fs.unlinkSync(f.path);
    }
    res.json({ message: 'Uploaded to media.nz.', links });
  } else {
    res.status(400).json({ message: 'Unknown provider.' });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`File manager running at http://localhost:${port}`);
});
