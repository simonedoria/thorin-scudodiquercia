const Uniswap = require('./uniswap.js');

module.exports = {
    /**
     * Identifica un candidato MEV da una transazione specifica su Uniswap.
     * @param {Object} web3Http - L'istanza di Web3 HTTP.
     * @param {Array} abis - Gli ABI dei contratti da utilizzare.
     * @param {Object} transaction - La transazione da analizzare.
     * @returns {Object|null} Un oggetto contenente i dati della transazione se è un candidato MEV, altrimenti null.
     */
    getCandidateForMev: (web3Http, abis, transaction) => {
        try {
            // Ottieni i dati di input dalla transazione usando Uniswap.getInputData
            let inputData = Uniswap.getInputData(web3Http, abis, transaction);
            
            // Se inputData non è null, significa che abbiamo un candidato MEV
            if (inputData !== null) {
                return {
                    dex: "UNISWAP",
                    ...inputData
                };
            }
        } catch (error) {
            console.error('Error while getting candidate for MEV:', error);
        }
        
        // Se inputData è null o si è verificato un errore, ritorna null
        return null;
    }
};
