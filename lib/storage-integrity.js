const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function safeRemove(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return '';
  } catch (error) {
    return error.message;
  }
}

function stageUploadFiles(files, directory, nameFactory = () => crypto.randomBytes(16).toString('hex')) {
  fs.mkdirSync(directory, { recursive: true });
  const staged = [];
  try {
    (files || []).forEach(file => {
      const filename = String(nameFactory()).toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(filename)) throw new Error('Upload storage generated an invalid filename.');
      const finalPath = path.join(directory, filename);
      const stagingPath = path.join(directory, `.staging-${filename}-${process.pid}`);
      fs.writeFileSync(stagingPath, file.buffer);
      staged.push({ ...file, filename, path: stagingPath, finalPath });
    });
    return staged;
  } catch (error) {
    staged.forEach(file => safeRemove(file.path));
    throw error;
  }
}

function rollbackStagedUploads(files) {
  (files || []).forEach(file => {
    safeRemove(file.path);
    safeRemove(file.finalPath);
  });
}

function commitStagedUploads(files, persistData) {
  const committed = [];
  try {
    (files || []).forEach(file => {
      fs.renameSync(file.path, file.finalPath);
      committed.push(file);
      file.path = file.finalPath;
    });
    persistData();
  } catch (error) {
    committed.forEach(file => safeRemove(file.finalPath));
    (files || []).forEach(file => safeRemove(file.path));
    throw error;
  }
}

function commitFileDeletions(filePaths, persistData) {
  const staged = [];
  try {
    [...new Set((filePaths || []).filter(Boolean))].forEach(filePath => {
      if (!fs.existsSync(filePath)) return;
      const trashPath = path.join(path.dirname(filePath), `.trash-${path.basename(filePath)}-${crypto.randomBytes(6).toString('hex')}`);
      fs.renameSync(filePath, trashPath);
      staged.push({ filePath, trashPath });
    });
    persistData();
  } catch (error) {
    staged.reverse().forEach(item => {
      if (fs.existsSync(item.trashPath)) fs.renameSync(item.trashPath, item.filePath);
    });
    throw error;
  }
  return staged.map(item => safeRemove(item.trashPath)).filter(Boolean);
}

function transcriptDiskPath(transcript, directory) {
  const file = String(transcript && transcript.file || '');
  const match = file.match(/^\/uploads\/transcripts\/([a-f0-9]{32})$/i);
  return match ? path.join(directory, match[1]) : '';
}

function reconcileUploadDirectory(data, directory) {
  if (!fs.existsSync(directory)) return [];
  const referenced = new Set();
  Object.values(data && data.projects || {}).forEach(project => {
    (project.transcripts || []).forEach(transcript => {
      const diskPath = transcriptDiskPath(transcript, directory);
      if (diskPath) referenced.add(path.basename(diskPath));
    });
  });
  const changes = [];
  fs.readdirSync(directory).forEach(name => {
    const trashMatch = name.match(/^\.trash-([a-f0-9]{32})-[a-f0-9]+$/i);
    if (trashMatch) {
      const originalName = trashMatch[1];
      const trashPath = path.join(directory, name);
      const originalPath = path.join(directory, originalName);
      if (referenced.has(originalName) && !fs.existsSync(originalPath)) {
        fs.renameSync(trashPath, originalPath);
        changes.push(`restored:${originalName}`);
      } else if (fs.statSync(trashPath).isFile()) {
        fs.unlinkSync(trashPath);
        changes.push(`removed:${name}`);
      }
      return;
    }
    const managed = /^[a-f0-9]{32}$/i.test(name) || /^\.(?:staging|trash)-/.test(name);
    if (!managed || referenced.has(name)) return;
    const filePath = path.join(directory, name);
    if (fs.statSync(filePath).isFile()) {
      fs.unlinkSync(filePath);
      changes.push(`removed:${name}`);
    }
  });
  return changes;
}

module.exports = {
  stageUploadFiles,
  rollbackStagedUploads,
  commitStagedUploads,
  commitFileDeletions,
  transcriptDiskPath,
  reconcileUploadDirectory
};
