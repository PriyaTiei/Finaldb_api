const express = require('express');
const fs = require('fs');
const path = require('path');
const { createReadStream } = require('fs');
const { parse } = require('csv-parse');
const app = express();
const PORT = 8121;

// Helper function to pad station numbers with leading zeros
function padStationNumber(station) {
  return station.padStart(3, '0');
}

// Function to parse the specific CSV format with metadata headers
// async function parseCustomCSV(filePath) {
//   return new Promise((resolve, reject) => {
//     const rows = [];
//     let headers = [];
//     let isHeaderRow = false;
//     let lineCounter = 0;
    
//     createReadStream(filePath)
//       .pipe(parse({
//         delimiter: ',',
//         relax_quotes: true,
//         skip_empty_lines: true
//       }))
//       .on('data', (row) => {
//         lineCounter++;
        
//         // Skip the first three lines (metadata)
//         if (lineCounter <= 3) {
//           return;
//         }
        
//         // The fourth line contains the column headers
//         if (lineCounter === 4) {
//           headers = row;
//           isHeaderRow = true;
//           return;
//         }
        
//         // Process data rows
//         if (isHeaderRow) {
//           const rowData = {};
//           headers.forEach((header, index) => {
//             // Remove quotes from header names
//             const cleanHeader = header.replace(/"/g, '');
//             rowData[cleanHeader] = row[index]?.replace(/"/g, '') || '';
//           });
//           rows.push(rowData);
//         }
//       })
//       .on('end', () => {
//         // Extract metadata from the file
//         const metadata = {
//           fileInfo: {
//             machine: 'UEC-4800', // From line 2 in the file
//             saveDateTime: lineCounter > 2 ? rows[0]['Save date/time'] : '' // Extracted from metadata
//           },
//           headers: headers.map(h => h.replace(/"/g, '')),
//           data: rows
//         };
        
//         resolve(metadata);
//       })
//       .on('error', (err) => {
//         reject(err);
//       });
//   });
// }



async function parseCustomCSV(filePath) {
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
        relax_column_count: true  // This is the key fix - allow rows to have different numbers of columns
      }))
      .on('data', (row) => {
        lineCounter++;
        
        // Extract metadata from first three lines
        if (lineCounter === 1) {
          // First line metadata - can be ignored or stored
          return;
        }
        if (lineCounter === 2) {
          // Second line contains machine info
          metadata.fileInfo.machine = row[0]?.replace(/"/g, '') || 'UEC-4800';
          return;
        }
        if (lineCounter === 3) {
          // Third line contains save date/time
          metadata.fileInfo.saveDateTime = row[0]?.replace(/"/g, '') || '';
          return;
        }
        
        // The fourth line contains the column headers
        if (lineCounter === 4) {
          headers = row.map(h => h.replace(/"/g, ''));
          return;
        }
        
        // Process data rows (line 5 and beyond)
        if (lineCounter > 4) {
          const rowData = {};
          headers.forEach((header, index) => {
            rowData[header] = row[index]?.replace(/"/g, '') || '';
          });
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




// Main endpoint to fetch torque data from CSV file
app.get('/api/torque-data', async (req, res) => {
  try {
    const { station, date, time } = req.query;
    
    // Validate required parameters
    if (!station || !date) {
      return res.status(400).json({
        error: 'Missing required parameters. Please provide both station and date.'
      });
    }
    
    // Pad station number with leading zeros
    const stationFolder = padStationNumber(station);
    
    // Construct the path to the date folder
    const basePath = path.join('/mnt/windows_share/Documents/DATA-28mar', stationFolder, 'UEC-4800', date);
    
    // Check if path exists
    if (!fs.existsSync(basePath)) {
      return res.status(404).json({
        error: `Path not found. Station ${station} or date ${date} may be invalid.`
      });
    }
    
    // Find F-Data CSV files
    const files = fs.readdirSync(basePath);
    const fDataFile = files.find(file => file.startsWith('F-Data') && file.endsWith('.csv'));
    
    if (!fDataFile) {
      return res.status(404).json({
        error: 'No F-Data CSV files found in the specified directory.'
      });
    }
    
    const csvFilePath = path.join(basePath, fDataFile);
    
    // Parse the CSV file with our custom parser
    const parsedData = await parseCustomCSV(csvFilePath);
    
    // If time is provided, filter the data to return just that record
    if (time) {
      const filteredData = parsedData.data.filter(row => 
        row['Tightening date/time'] && row['Tightening date/time'].includes(time)
      );
      
      if (filteredData.length === 0) {
        return res.status(404).json({
          error: `No records found for the specified time: ${time}`
        });
      }
      
      return res.json({
        station,
        date,
        file: fDataFile,
        metadata: parsedData.fileInfo,
        timeFilter: time,
        data: filteredData
      });
    }
    
    // Return all data if no time filter is provided
    res.json({
      station,
      date,
      file: fDataFile,
      metadata: parsedData.fileInfo,
      data: parsedData.data
    });
      
  } catch (error) {
    res.status(500).json({
      error: `An error occurred: ${error.message}`
    });
  }
});

// Endpoint to get available station folders
app.get('/api/stations', (req, res) => {
  try {
    const basePath = '/mnt/windows_share/Documents/DATA-28mar';
    
    // Ensure the base path exists
    if (!fs.existsSync(basePath)) {
      return res.status(404).json({
        error: 'Base path not found on server.'
      });
    }
    
    // Get all station folders
    const stations = fs.readdirSync(basePath)
      .filter(folder => {
        const folderPath = path.join(basePath, folder);
        return fs.statSync(folderPath).isDirectory() && /^\d+$/.test(folder);
      })
      .sort((a, b) => parseInt(a) - parseInt(b));
    
    res.json({
      stations
    });
    
  } catch (error) {
    res.status(500).json({
      error: `An error occurred: ${error.message}`
    });
  }
});

// Endpoint to get available date folders for a specific station
app.get('/api/dates', (req, res) => {
  try {
    const { station } = req.query;
    
    if (!station) {
      return res.status(400).json({
        error: 'Missing required parameter: station'
      });
    }
    
    // Pad station number with leading zeros
    const stationFolder = padStationNumber(station);
    
    // Construct path to UEC-4800 folder
    const basePath = path.join('/mnt/windows_share/Documents/DATA-28mar', stationFolder, 'UEC-4800');
    
    if (!fs.existsSync(basePath)) {
      return res.status(404).json({
        error: `Station folder ${station} not found.`
      });
    }
    
    // Get all date folders
    const dates = fs.readdirSync(basePath)
      .filter(folder => {
        const folderPath = path.join(basePath, folder);
        return fs.statSync(folderPath).isDirectory();
      })
      .sort();
    
    res.json({
      station,
      dates
    });
    
  } catch (error) {
    res.status(500).json({
      error: `An error occurred: ${error.message}`
    });
  }
});

// Endpoint to get available timestamps in a specific date folder
app.get('/api/timestamps', async (req, res) => {
  try {
    const { station, date } = req.query;
    
    if (!station || !date) {
      return res.status(400).json({
        error: 'Missing required parameters. Please provide both station and date.'
      });
    }
    
    // Pad station number with leading zeros
    const stationFolder = padStationNumber(station);
    
    // Construct the path to the date folder
    const basePath = path.join('/mnt/windows_share/Documents/DATA-28mar', stationFolder, 'UEC-4800', date);
    
    if (!fs.existsSync(basePath)) {
      return res.status(404).json({
        error: `Path not found. Station ${station} or date ${date} may be invalid.`
      });
    }
    
    // Find F-Data CSV file
    const files = fs.readdirSync(basePath);
    const fDataFile = files.find(file => file.startsWith('F-Data') && file.endsWith('.csv'));
    
    if (!fDataFile) {
      return res.status(404).json({
        error: 'No F-Data CSV files found in the specified directory.'
      });
    }
    
    const csvFilePath = path.join(basePath, fDataFile);
    
    // Parse the CSV file
    const parsedData = await parseCustomCSV(csvFilePath);
    
    // Extract unique timestamps
    const timestamps = [...new Set(
      parsedData.data
        .map(row => row['Tightening date/time'])
        .filter(Boolean)
    )].sort();
    
    res.json({
      station,
      date,
      file: fDataFile,
      timestamps
    });
    
  } catch (error) {
    res.status(500).json({
      error: `An error occurred: ${error.message}`
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
