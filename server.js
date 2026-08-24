const express = require('express');
require('dotenv').config();
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { createReadStream } = require('fs');
const { parse } = require('csv-parse');
const app = express();
const PORT = process.env.PORT || 8121; 

async function pathExists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// In-Memory dynamic cache for discovered data paths (5-minute TTL)
let cachedBaseDataPaths = null;
let lastPathsDiscoveryTime = 0;
const PATHS_DISCOVERY_TTL_MS = 5 * 60 * 1000;

// Base data paths configuration (supports single path, comma-separated list, or dynamic DATA-* subfolder discovery)
async function getBaseDataPaths() {
  const now = Date.now();
  if (cachedBaseDataPaths && (now - lastPathsDiscoveryTime < PATHS_DISCOVERY_TTL_MS)) {
    return cachedBaseDataPaths;
  }

  const rawPaths = (process.env.TORQUE_DATA_PATH || process.env.BASE_PATH || '/mnt/torque_wrench')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  const discoveredPaths = [];

  for (const rootPath of rawPaths) {
    // 1. Include root directory directly (for flat directory structures)
    discoveredPaths.push(rootPath);

    // 2. Discover ALL subdirectories (DATA-*, Backup, Live, etc.)
    try {
      if (await pathExists(rootPath)) {
        const entries = await fsp.readdir(rootPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('$')) {
            discoveredPaths.push(path.join(rootPath, entry.name));
          }
        }
      }
    } catch (err) {
      console.warn(`Warning: Could not scan root path ${rootPath}:`, err.message);
    }
  }

  cachedBaseDataPaths = [...new Set(discoveredPaths)];
  lastPathsDiscoveryTime = now;
  return cachedBaseDataPaths;
}

const stationMapping = {
  '1': ['27', '59'],
  '7': ['57'],
  '17': ['51', '39'],
  '21': ['24', '25'],
  '22': ['35'],
  '23': ['22', '23', '26'],
  '26': ['60', '54', '56'],
  '28': ['38', '16'],
  '31': ['21'],
  '43': ['14'],
  '45': ['49'],
  '46': ['20', '29'],
  '51': ['17', '58'],
  '52': ['31', '34', '32'],
  '53': ['36'],
  '55': ['32', '10'],
  '56': ['41'],
  '57': ['30'],
  '58': ['45', '46', '55', '47'],
  '59': ['42', '52', '53'],
  '60': ['48', '51', '50'],
  '61': ['61', '58', '20'],
  '62': ['43', '63', '44'],
  'Block sub assy': ['1', '15', '18', '19', '40'],
  'Cam housing sub assy': ['5', '6', '7', '8']
};

function getStationFolders(station, folder) {
  if (folder) {
    const folders = Array.isArray(folder) ? folder : folder.toString().split(',');
    return folders.map(f => padStationNumber(f.trim()));
  }
  if (station && stationMapping[station]) {
    return stationMapping[station].map(folder => padStationNumber(folder));
  }
  // Dynamic fallback: if station itself is a numeric folder number
  if (station && /^\d+$/.test(station.toString())) {
    return [padStationNumber(station.toString())];
  }
  return [];
}

function isValidStation(station, folder) {
  if (folder) return true;
  if (!station) return false;
  return Object.prototype.hasOwnProperty.call(stationMapping, station) || /^\d+$/.test(station.toString());
}

function padStationNumber(station) {
  return station.padStart(3, '0');
}

// In-Memory MTime Cache to avoid repeated disk reads & CSV parsing for the same files
const fileCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 300;

async function parseCustomCSV(filePath, folderNumber) {
  try {
    const stats = await fsp.stat(filePath);
    const cached = fileCache.get(filePath);

    if (cached && cached.mtimeMs === stats.mtimeMs && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
      return cached.data;
    }

    const parsedResult = await new Promise((resolve, reject) => {
      const rows = [];
      let headers = [];
      let metadata = {
        fileInfo: {
          machine: 'UEC-4800',
          saveDateTime: ''
        }
      };
      let lineCounter = 0;
      
      createReadStream(filePath)
        .pipe(parse({
          delimiter: ',',
          relax_quotes: true,
          skip_empty_lines: true,
          relax_column_count: true  
        }))
        .on('data', (row) => {
          lineCounter++;
          
          if (lineCounter === 1) return;
          if (lineCounter === 2) {
            metadata.fileInfo.machine = row[0]?.replace(/"/g, '') || 'UEC-4800';
            return;
          }
          if (lineCounter === 3) {
            metadata.fileInfo.saveDateTime = row[0]?.replace(/"/g, '') || '';
            return;
          }
          if (lineCounter === 4) {
            headers = row.map(h => h.replace(/"/g, ''));
            return;
          }
          if (lineCounter > 4) {
            const rowData = {};
            headers.forEach((header, index) => {
              rowData[header] = row[index]?.replace(/"/g, '') || '';
            });
            rowData['folder'] = folderNumber;
            rows.push(rowData);
          }
        })
        .on('end', () => {
          metadata.headers = headers;
          metadata.data = rows;
          resolve(metadata);
        })
        .on('error', (err) => {
          reject(err);
        });
    });

    // Prune cache if exceeded
    if (fileCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = fileCache.keys().next().value;
      fileCache.delete(oldestKey);
    }

    fileCache.set(filePath, {
      mtimeMs: stats.mtimeMs,
      cachedAt: Date.now(),
      data: parsedResult
    });

    return parsedResult;
  } catch (err) {
    throw err;
  }
}

app.get('/api/torque-data', async (req, res) => {
  try {
    const { station, date, time, folder } = req.query;
    
    if ((!station && !folder) || !date) {
      return res.status(400).json({
        error: 'Missing required parameters. Please provide both station/folder and date.'
      });
    }
    
    if (!isValidStation(station, folder)) {
      return res.status(404).json({
        error: `Station ${station} is not valid or has no mapped folders.`
      });
    }
    
    const stationFolders = getStationFolders(station, folder);
    let combinedData = [];
    let foundData = false;
    let fileInfo = null;
    let foundFile = null;
    const baseDataPaths = await getBaseDataPaths();
    
    for (const basePathRoot of baseDataPaths) {
      for (const folderNumber of stationFolders) {
        const basePath = path.join(basePathRoot, folderNumber, 'UEC-4800', date);
        
        if (!(await pathExists(basePath))) {
          continue;
        }
        
        const files = await fsp.readdir(basePath);
        const fDataFiles = files.filter(file => file.startsWith('F-Data') && file.endsWith('.csv')).sort();
        
        if (fDataFiles.length === 0) {
          continue;
        }
        
        for (const fDataFile of fDataFiles) {
          const csvFilePath = path.join(basePath, fDataFile);
          const parsedData = await parseCustomCSV(csvFilePath, folderNumber);
          
          if (!fileInfo) {
            fileInfo = parsedData.fileInfo;
            foundFile = fDataFile;
          }
          
          if (time) {
            const filteredData = parsedData.data.filter(row => 
              row['Tightening date/time'] && row['Tightening date/time'].includes(time)
            );
            
            if (filteredData.length > 0) {
              combinedData = combinedData.concat(filteredData);
              foundData = true;
            }
          } else {
            combinedData = combinedData.concat(parsedData.data);
            foundData = true;
          }
        }
      }
    }
    
    if (!foundData) {
      if (time) {
        return res.status(404).json({
          error: `No records found for station ${station}, date ${date}, and time ${time}`
        });
      } else {
        return res.status(404).json({
          error: `No data found for station ${station} and date ${date}`
        });
      }
    }
    
    res.json({
      station,
      date,
      file: foundFile,
      mappedFolders: stationFolders,
      metadata: fileInfo,
      timeFilter: time || undefined,
      data: combinedData
    });
      
  } catch (error) {
    res.status(500).json({
      error: `An error occurred: ${error.message}`
    });
  }
});

app.get('/api/stations', (req, res) => {
  try {
    const mappedStations = Object.keys(stationMapping).sort((a, b) => parseInt(a) - parseInt(b));
    res.json({
      stations: mappedStations,
      stationMappings: stationMapping
    });
  } catch (error) {
    res.status(500).json({
      error: `An error occurred: ${error.message}`
    });
  }
});

app.get('/api/dates', async (req, res) => {
  try {
    const { station, folder } = req.query;
    
    if (!station && !folder) {
      return res.status(400).json({
        error: 'Missing required parameter: station or folder'
      });
    }
    
    if (!isValidStation(station, folder)) {
      return res.status(404).json({
        error: `Station ${station} is not valid or has no mapped folders.`
      });
    }
  
    const stationFolders = getStationFolders(station, folder);
    let allDates = [];
    let foundFolder = false;
    const baseDataPaths = await getBaseDataPaths();
    
    for (const basePathRoot of baseDataPaths) {
      for (const folderNumber of stationFolders) {
        const basePath = path.join(basePathRoot, folderNumber, 'UEC-4800');
        
        if (!(await pathExists(basePath))) {
          continue;
        }
        
        foundFolder = true;
        const entries = await fsp.readdir(basePath, { withFileTypes: true });
        const dates = entries.filter(e => e.isDirectory()).map(e => e.name);
        
        allDates = [...allDates, ...dates];
      }
    }
    
    if (!foundFolder) {
      return res.status(404).json({
        error: `No folders found for station ${station}.`
      });
    }
    
    allDates = [...new Set(allDates)].sort();
    
    res.json({
      station,
      mappedFolders: stationFolders,
      dates: allDates
    });
    
  } catch (error) {
    res.status(500).json({
      error: `An error occurred: ${error.message}`
    });
  }
});

app.get('/api/timestamps', async (req, res) => {
  try {
    const { station, date, folder } = req.query;
    
    if ((!station && !folder) || !date) {
      return res.status(400).json({
        error: 'Missing required parameters. Please provide both station/folder and date.'
      });
    }
    
    if (!isValidStation(station, folder)) {
      return res.status(404).json({
        error: `Station ${station} is not valid or has no mapped folders.`
      });
    }
    
    const stationFolders = getStationFolders(station, folder);
    let allTimestamps = [];
    let foundFile = null;
    let foundData = false;
    const baseDataPaths = await getBaseDataPaths();
    
    for (const basePathRoot of baseDataPaths) {
      for (const folderNumber of stationFolders) {
        const basePath = path.join(basePathRoot, folderNumber, 'UEC-4800', date);

        if (!(await pathExists(basePath))) {
          continue;
        }
        
        const files = await fsp.readdir(basePath);
        const fDataFiles = files.filter(file => file.startsWith('F-Data') && file.endsWith('.csv')).sort();
        
        if (fDataFiles.length === 0) {
          continue;
        }
        
        if (!foundFile) {
          foundFile = fDataFiles[0];
        }
        
        for (const fDataFile of fDataFiles) {
          const csvFilePath = path.join(basePath, fDataFile);
          const parsedData = await parseCustomCSV(csvFilePath, folderNumber);
          
          const folderTimestamps = parsedData.data
            .map(row => row['Tightening date/time'])
            .filter(Boolean);
          
          if (folderTimestamps.length > 0) {
            allTimestamps = [...allTimestamps, ...folderTimestamps];
            foundData = true;
          }
        }
      }
    }
    
    if (!foundData) {
      return res.status(404).json({
        error: `No timestamps found for station ${station} and date ${date}`
      });
    }
    
    allTimestamps = [...new Set(allTimestamps)].sort();
    
    res.json({
      station,
      date,
      mappedFolders: stationFolders,
      file: foundFile,
      timestamps: allTimestamps
    });
    
  } catch (error) {
    res.status(500).json({
      error: `An error occurred: ${error.message}`
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    basePaths: await getBaseDataPaths()
  });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server running on port ${PORT}`);
  const initialPaths = await getBaseDataPaths();
  console.log(`Base data paths configured: ${JSON.stringify(initialPaths)}`);
  console.log(`Station mappings configured: ${JSON.stringify(stationMapping)}`);
});




