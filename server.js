// const express = require('express');
// const fs = require('fs');
// const path = require('path');
// const { createReadStream } = require('fs');
// const { parse } = require('csv-parse');
// const app = express();
// const PORT = 8121;

// // Station mapping configuration
// const stationMapping = {
//   '1': ['27', '59'],
//   '7': ['28', '16'],
//   '21': ['25', '24'],
//   // Add more mappings as needed
// };

// // Helper function to get folder paths for a station
// function getStationFolders(station) {
//   if (stationMapping[station]) {
//     return stationMapping[station].map(folder => padStationNumber(folder));
//   }
//   // Default behavior: use the station number itself if no mapping exists
//   return [padStationNumber(station)];
// }

// // Helper function to pad station numbers with leading zeros
// function padStationNumber(station) {
//   return station.padStart(3, '0');
// }

// async function parseCustomCSV(filePath) {
//   return new Promise((resolve, reject) => {
//     const rows = [];
//     let headers = [];
//     let metadata = {
//       fileInfo: {
//         machine: 'UEC-4800',
//         saveDateTime: ''
//       }
//     };
//     let lineCounter = 0;
    
//     createReadStream(filePath)
//       .pipe(parse({
//         delimiter: ',',
//         relax_quotes: true,
//         skip_empty_lines: true,
//         relax_column_count: true  // This is the key fix - allow rows to have different numbers of columns
//       }))
//       .on('data', (row) => {
//         lineCounter++;
        
//         // Extract metadata from first three lines
//         if (lineCounter === 1) {
//           // First line metadata - can be ignored or stored
//           return;
//         }
//         if (lineCounter === 2) {
//           // Second line contains machine info
//           metadata.fileInfo.machine = row[0]?.replace(/"/g, '') || 'UEC-4800';
//           return;
//         }
//         if (lineCounter === 3) {
//           // Third line contains save date/time
//           metadata.fileInfo.saveDateTime = row[0]?.replace(/"/g, '') || '';
//           return;
//         }
        
//         // The fourth line contains the column headers
//         if (lineCounter === 4) {
//           headers = row.map(h => h.replace(/"/g, ''));
//           return;
//         }
        
//         // Process data rows (line 5 and beyond)
//         if (lineCounter > 4) {
//           const rowData = {};
//           headers.forEach((header, index) => {
//             rowData[header] = row[index]?.replace(/"/g, '') || '';
//           });
//           rows.push(rowData);
//         }
//       })
//       .on('end', () => {
//         metadata.headers = headers;
//         metadata.data = rows;
//         resolve(metadata);
//       })
//       .on('error', (err) => {
//         reject(err);
//       });
//   });
// }

// // Main endpoint to fetch torque data from CSV file
// app.get('/api/torque-data', async (req, res) => {
//   try {
//     const { station, date, time } = req.query;
    
//     // Validate required parameters
//     if (!station || !date) {
//       return res.status(400).json({
//         error: 'Missing required parameters. Please provide both station and date.'
//       });
//     }
    
//     // Get mapped folders for the station
//     const stationFolders = getStationFolders(station);
//     let combinedData = [];
//     let foundData = false;
//     let fileInfo = null;
//     let foundFile = null;
    
//     // Iterate through all mapped folders
//     for (const folderNumber of stationFolders) {
//       // Construct the path to the date folder
//       const basePath = path.join('/mnt/windows_share/Documents/DATA-28mar', folderNumber, 'UEC-4800', date);
      
//       // Skip if path doesn't exist
//       if (!fs.existsSync(basePath)) {
//         continue;
//       }
      
//       // Find F-Data CSV files
//       const files = fs.readdirSync(basePath);
//       const fDataFile = files.find(file => file.startsWith('F-Data') && file.endsWith('.csv'));
      
//       if (!fDataFile) {
//         continue;
//       }
      
//       const csvFilePath = path.join(basePath, fDataFile);
      
//       // Parse the CSV file with our custom parser
//       const parsedData = await parseCustomCSV(csvFilePath);
      
//       // Store file info from the first valid folder
//       if (!fileInfo) {
//         fileInfo = parsedData.fileInfo;
//         foundFile = fDataFile;
//       }
      
//       // If time is provided, filter the data
//       if (time) {
//         const filteredData = parsedData.data.filter(row => 
//           row['Tightening date/time'] && row['Tightening date/time'].includes(time)
//         );
        
//         if (filteredData.length > 0) {
//           combinedData = combinedData.concat(filteredData);
//           foundData = true;
//         }
//       } else {
//         // Add all data if no time filter
//         combinedData = combinedData.concat(parsedData.data);
//         foundData = true;
//       }
//     }
    
//     // Return error if no data found in any of the mapped folders
//     if (!foundData) {
//       if (time) {
//         return res.status(404).json({
//           error: `No records found for station ${station}, date ${date}, and time ${time}`
//         });
//       } else {
//         return res.status(404).json({
//           error: `No data found for station ${station} and date ${date}`
//         });
//       }
//     }
    
//     // Return the combined data
//     res.json({
//       station,
//       date,
//       file: foundFile,
//       mappedFolders: stationFolders,
//       metadata: fileInfo,
//       timeFilter: time || undefined,
//       data: combinedData
//     });
      
//   } catch (error) {
//     res.status(500).json({
//       error: `An error occurred: ${error.message}`
//     });
//   }
// });

// // Endpoint to get available station folders
// app.get('/api/stations', (req, res) => {
//   try {
//     // Return all stations from the mapping plus any additional folders in the base directory
//     const basePath = '/mnt/windows_share/Documents/DATA-28mar';
    
//     // Ensure the base path exists
//     if (!fs.existsSync(basePath)) {
//       return res.status(404).json({
//         error: 'Base path not found on server.'
//       });
//     }
    
//     // Get all mappable stations
//     const mappedStations = Object.keys(stationMapping).sort((a, b) => parseInt(a) - parseInt(b));
    
//     // You can also include automatic discovery of directories if needed
//     // This is optional - you might want to just use the explicit mapping
//     const allFolders = fs.readdirSync(basePath)
//       .filter(folder => {
//         const folderPath = path.join(basePath, folder);
//         return fs.statSync(folderPath).isDirectory() && /^\d+$/.test(folder);
//       });
      
//     // Create a list of all stations that have mappings
//     const stations = [...new Set(mappedStations)];
    
//     res.json({
//       stations,
//       stationMappings: stationMapping
//     });
    
//   } catch (error) {
//     res.status(500).json({
//       error: `An error occurred: ${error.message}`
//     });
//   }
// });

// // Endpoint to get available date folders for a specific station
// app.get('/api/dates', (req, res) => {
//   try {
//     const { station } = req.query;
    
//     if (!station) {
//       return res.status(400).json({
//         error: 'Missing required parameter: station'
//       });
//     }
    
//     // Get mapped folders for the station
//     const stationFolders = getStationFolders(station);
//     let allDates = [];
//     let foundFolder = false;
    
//     // Iterate through all mapped folders for this station
//     for (const folderNumber of stationFolders) {
//       // Construct path to UEC-4800 folder
//       const basePath = path.join('/mnt/windows_share/Documents/DATA-28mar', folderNumber, 'UEC-4800');
      
//       if (!fs.existsSync(basePath)) {
//         continue;
//       }
      
//       foundFolder = true;
      
//       // Get all date folders from this mapped folder
//       const dates = fs.readdirSync(basePath)
//         .filter(folder => {
//           const folderPath = path.join(basePath, folder);
//           return fs.statSync(folderPath).isDirectory();
//         });
      
//       // Add to the combined list of dates
//       allDates = [...allDates, ...dates];
//     }
    
//     if (!foundFolder) {
//       return res.status(404).json({
//         error: `No folders found for station ${station}.`
//       });
//     }
    
//     // Remove duplicates and sort
//     allDates = [...new Set(allDates)].sort();
    
//     res.json({
//       station,
//       mappedFolders: stationFolders,
//       dates: allDates
//     });
    
//   } catch (error) {
//     res.status(500).json({
//       error: `An error occurred: ${error.message}`
//     });
//   }
// });

// // Endpoint to get available timestamps in a specific date folder
// app.get('/api/timestamps', async (req, res) => {
//   try {
//     const { station, date } = req.query;
    
//     if (!station || !date) {
//       return res.status(400).json({
//         error: 'Missing required parameters. Please provide both station and date.'
//       });
//     }
    
//     // Get mapped folders for the station
//     const stationFolders = getStationFolders(station);
//     let allTimestamps = [];
//     let foundFile = null;
//     let foundData = false;
    
//     // Iterate through all mapped folders
//     for (const folderNumber of stationFolders) {
//       // Construct the path to the date folder
//       const basePath = path.join('/mnt/windows_share/Documents/DATA-28mar', folderNumber, 'UEC-4800', date);
      
//       if (!fs.existsSync(basePath)) {
//         continue;
//       }
      
//       // Find F-Data CSV file
//       const files = fs.readdirSync(basePath);
//       const fDataFile = files.find(file => file.startsWith('F-Data') && file.endsWith('.csv'));
      
//       if (!fDataFile) {
//         continue;
//       }
      
//       if (!foundFile) {
//         foundFile = fDataFile;
//       }
      
//       const csvFilePath = path.join(basePath, fDataFile);
      
//       // Parse the CSV file
//       const parsedData = await parseCustomCSV(csvFilePath);
      
//       // Extract timestamps from this folder
//       const folderTimestamps = parsedData.data
//         .map(row => row['Tightening date/time'])
//         .filter(Boolean);
      
//       if (folderTimestamps.length > 0) {
//         allTimestamps = [...allTimestamps, ...folderTimestamps];
//         foundData = true;
//       }
//     }
    
//     if (!foundData) {
//       return res.status(404).json({
//         error: `No timestamps found for station ${station} and date ${date}`
//       });
//     }
    
//     // Remove duplicates and sort
//     allTimestamps = [...new Set(allTimestamps)].sort();
    
//     res.json({
//       station,
//       date,
//       mappedFolders: stationFolders,
//       file: foundFile,
//       timestamps: allTimestamps
//     });
    
//   } catch (error) {
//     res.status(500).json({
//       error: `An error occurred: ${error.message}`
//     });
//   }
// });

// app.listen(PORT, '0.0.0.0', () => {
//   console.log(`Server running on port ${PORT}`);
//   console.log(`Station mappings configured: ${JSON.stringify(stationMapping)}`);
// });
    


const express = require('express');
const fs = require('fs');
const path = require('path');
const { createReadStream } = require('fs');
const { parse } = require('csv-parse');
const app = express();
const PORT = 8121;


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

// Helper function to get folder paths for a station
function getStationFolders(station) {
  if (stationMapping[station]) {
    return stationMapping[station].map(folder => padStationNumber(folder));
  }
  
  return [];
}

// Helper function to check if station is valid (has mapping)
function isValidStation(station) {
  return Object.keys(stationMapping).includes(station);
}

// Helper function to pad station numbers with leading zeros
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
          
          // Add the folder as a separate field
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
    
    // Check if station is valid
    if (!isValidStation(station)) {
      return res.status(404).json({
        error: `Station ${station} is not valid or has no mapped folders.`
      });
    }
    
    // Get mapped folders for the station
    const stationFolders = getStationFolders(station);
    let combinedData = [];
    let foundData = false;
    let fileInfo = null;
    let foundFile = null;
    
    // Iterate through all mapped folders
    for (const folderNumber of stationFolders) {
      // Construct the path to the date folder
      const basePath = path.join('/mnt/torque_final/DATA-28mar', folderNumber, 'UEC-4800', date);
      
      // Skip if path doesn't exist
      if (!fs.existsSync(basePath)) {
        continue;
      }
      
      // Find F-Data CSV files
      const files = fs.readdirSync(basePath);
      const fDataFile = files.find(file => file.startsWith('F-Data') && file.endsWith('.csv'));
      
      if (!fDataFile) {
        continue;
      }
      
      const csvFilePath = path.join(basePath, fDataFile);
      
      // Parse the CSV file with our custom parser - pass the folder number to include in data
      const parsedData = await parseCustomCSV(csvFilePath, folderNumber);
      
      // Store file info from the first valid folder
      if (!fileInfo) {
        fileInfo = parsedData.fileInfo;
        foundFile = fDataFile;
      }
      
      // If time is provided, filter the data
      if (time) {
        const filteredData = parsedData.data.filter(row => 
          row['Tightening date/time'] && row['Tightening date/time'].includes(time)
        );
        
        if (filteredData.length > 0) {
          combinedData = combinedData.concat(filteredData);
          foundData = true;
        }
      } else {
        // Add all data if no time filter
        combinedData = combinedData.concat(parsedData.data);
        foundData = true;
      }
    }
    
    // Return error if no data found in any of the mapped folders
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
    
    // Return the combined data
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

// Endpoint to get available station folders
app.get('/api/stations', (req, res) => {
  try {
    // Only return stations from the mapping, no automatic discovery
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

// Endpoint to get available date folders for a specific station
app.get('/api/dates', (req, res) => {
  try {
    const { station } = req.query;
    
    if (!station) {
      return res.status(400).json({
        error: 'Missing required parameter: station'
      });
    }
    
    // Check if station is valid
    if (!isValidStation(station)) {
      return res.status(404).json({
        error: `Station ${station} is not valid or has no mapped folders.`
      });
    }
    
    // Get mapped folders for the station
    const stationFolders = getStationFolders(station);
    let allDates = [];
    let foundFolder = false;
    
    // Iterate through all mapped folders for this station
    for (const folderNumber of stationFolders) {
      // Construct path to UEC-4800 folder
      const basePath = path.join('/mnt/torque_final/DATA-28mar', folderNumber, 'UEC-4800');
      
      if (!fs.existsSync(basePath)) {
        continue;
      }
      
      foundFolder = true;
      
      // Get all date folders from this mapped folder
      const dates = fs.readdirSync(basePath)
        .filter(folder => {
          const folderPath = path.join(basePath, folder);
          return fs.statSync(folderPath).isDirectory();
        });
      
      // Add to the combined list of dates
      allDates = [...allDates, ...dates];
    }
    
    if (!foundFolder) {
      return res.status(404).json({
        error: `No folders found for station ${station}.`
      });
    }
    
    // Remove duplicates and sort
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

// Endpoint to get available timestamps in a specific date folder
app.get('/api/timestamps', async (req, res) => {
  try {
    const { station, date } = req.query;
    
    if (!station || !date) {
      return res.status(400).json({
        error: 'Missing required parameters. Please provide both station and date.'
      });
    }
    
    // Check if station is valid
    if (!isValidStation(station)) {
      return res.status(404).json({
        error: `Station ${station} is not valid or has no mapped folders.`
      });
    }
    
    // Get mapped folders for the station
    const stationFolders = getStationFolders(station);
    let allTimestamps = [];
    let foundFile = null;
    let foundData = false;
    
    // Iterate through all mapped folders
    for (const folderNumber of stationFolders) {
      // Construct the path to the date folder
      // const basePath = path.join('/mnt/windows_share/Documents/DATA-28mar', folderNumber, 'UEC-4800', date);
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
      
      // Extract timestamps from this folder
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
    
    // Remove duplicates and sort
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




