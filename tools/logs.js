const fs = require('fs');
const path = require('path');

module.exports = {
    saveTransaction: (obj, filePath) => {
        // Convert the object to a string
        let data = JSON.stringify(obj, null, 2);

        // Check if the file exists
        fs.access(filePath, fs.F_OK, (err) => {
            if (err) {
                // File does not exist, write the string to a new file
                fs.writeFile(filePath, data, (err) => {
                    if (err) {
                        console.error('Error writing file', err)
                    } else {
                        console.log('Successfully wrote file')
                    }
                });
            } else {
                // File exists, append the string to the existing file
                fs.appendFile(filePath, ',\n' + data, (err) => {
                    if (err) {
                        console.error('Error writing file', err)
                    } else {
                        console.log('Successfully wrote file')
                    }
                });
            }
        });
    },
    getFilePath: () => {
        // Get the current date and time
        let date = new Date();
        // Format the date and time
        let dateTime = `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}_${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;
        // Define the path of the file
        let filePath = path.join(__dirname, `${dateTime}.json`);
        return filePath;
    }
}