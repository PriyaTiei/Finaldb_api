const express = require('express');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createReadStream } = require('fs');
const { parse } = require('csv-parse');
const app = express();
const PORT = process.env.PORT || 8121; 


const stationMapping = {
  '1': ['27', '59'],
  // '7': ['28', '16','57'],
  '7':['57'],
  '17' : ['51', '39'],
  '21': ['25', '24'],
  '31' : ['21'],
  '23' :['22','23', '26'],
  '21' : ['24','25'],
  '22' : ['35'],
  '28' : ['38','16'],
  '26' : ['60', '54', '56'],
  '45' : ['49'],
  '43' : ['14'],
  '46' : ['20','29'],
  '51':['17','58'],
  '52':['31','34','32'],
  '53':['36'],
  '55': ['32','10'],
  '56': ['41'],
  '57': ['30'],
  '58': ['45', '46', '55','47'],
  '59':['42','52','53'],
  '61':['61','58','20'],
  '60':['48', '51','50'],
  '62':['43','63','44'],
  '23':['22','23','26'],
  'Block sub assy':['1','15','18','19','40'],
 'Cam housing sub assy':	['5','6','7','8'],
 
};


function getStationFolders(station) {
  if (stationMapping[station]) {
    return stationMapping[station].map(folder => padStationNumber(folder));
  }
  
  return [];
}


function isValidStation(station) {
  return Object.keys(stationMapping).includes(station);
}


function padStationNumber(station) {
  return station.padStart(3, '0');
}

async function parseCustomCSV(filePath, folderNumber) {
  return new Promise((resolve, reject) => {
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
        
      
        if (lineCounter === 1) {
          
          return;
        }
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
}


app.get('/api/torque-data', async (req, res) => {
  try {
    const { station, date, time } = req.query;
    
   
    if (!station || !date) {
      return res.status(400).json({
        error: 'Missing required parameters. Please provide both station and date.'
      });
    }
    
  
    if (!isValidStation(station)) {
      return res.status(404).json({
        error: `Station ${station} is not valid or has no mapped folders.`
      });
    }
    
   
    const stationFolders = getStationFolders(station);
    let combinedData = [];
    let foundData = false;
    let fileInfo = null;
    let foundFile = null;
    
   
    for (const folderNumber of stationFolders) {
     
      const basePath = path.join('/mnt/torque_final/DATA-28mar', folderNumber, 'UEC-4800', date);
      
    
      if (!fs.existsSync(basePath)) {
        continue;
      }
      
      
      const files = fs.readdirSync(basePath);
      const fDataFile = files.find(file => file.startsWith('F-Data') && file.endsWith('.csv'));
      
      if (!fDataFile) {
        continue;
      }
      
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


app.get('/api/dates', (req, res) => {
  try {
    const { station } = req.query;
    
    if (!station) {
      return res.status(400).json({
        error: 'Missing required parameter: station'
      });
    }
    
  
    if (!isValidStation(station)) {
      return res.status(404).json({
        error: `Station ${station} is not valid or has no mapped folders.`
      });
    }
  
    const stationFolders = getStationFolders(station);
    let allDates = [];
    let foundFolder = false;
    
    
    for (const folderNumber of stationFolders) {
    
      const basePath = path.join('/mnt/torque_final/DATA-28mar', folderNumber, 'UEC-4800');
      
      if (!fs.existsSync(basePath)) {
        continue;
      }
      
      foundFolder = true;
      
      
      const dates = fs.readdirSync(basePath)
        .filter(folder => {
          const folderPath = path.join(basePath, folder);
          return fs.statSync(folderPath).isDirectory();
        });
      
     
      allDates = [...allDates, ...dates];
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
    const { station, date } = req.query;
    
    if (!station || !date) {
      return res.status(400).json({
        error: 'Missing required parameters. Please provide both station and date.'
      });
    }
    
  
    if (!isValidStation(station)) {
      return res.status(404).json({
        error: `Station ${station} is not valid or has no mapped folders.`
      });
    }
    
    
    const stationFolders = getStationFolders(station);
    let allTimestamps = [];
    let foundFile = null;
    let foundData = false;
    
    
    for (const folderNumber of stationFolders) {
     
      const basePath = path.join('/mnt/torque_final/DATA-28mar', folderNumber, 'UEC-4800', date);


      if (!fs.existsSync(basePath)) {
        continue;
      }
      
      // Find F-Data CSV file     
      const files = fs.readdirSync(basePath);
      const fDataFile = files.find(file => file.startsWith('F-Data') && file.endsWith('.csv'));
      
      if (!fDataFile) {
        continue;
      }
      
      if (!foundFile) {
        foundFile = fDataFile;
      }
      
      const csvFilePath = path.join(basePath, fDataFile);
      
      // Parse the CSV file - include folder number
      const parsedData = await parseCustomCSV(csvFilePath, folderNumber);
      
      const folderTimestamps = parsedData.data
        .map(row => row['Tightening date/time'])
        .filter(Boolean);
      
      if (folderTimestamps.length > 0) {
        allTimestamps = [...allTimestamps, ...folderTimestamps];
        foundData = true;
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Station mappings configured: ${JSON.stringify(stationMapping)}`);
});




