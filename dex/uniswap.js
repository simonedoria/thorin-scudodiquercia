const InputDataDecoder = require('ethereum-input-data-decoder');
const abi = require('../abi.js');
const token = require('../tools/token.js');
const Web3 = require('web3');
const { ethers } = require('ethers');

const functionsToCheck = [
    'swapETHForExactTokens',
    'swapExactETHForTokens',
    'swapExactETHForTokensSupportingFeeOnTransferTokens'
];

const tokenToExclude = ['0xdac17f958d2ee523a2206206994597c13d831ec7'];

const extractDataFromInput = (web3Http, abi, input) => {
    try {
        const decoder = new InputDataDecoder(abi.abi);
        const inputData = decoder.decodeData(input);
        let objToReturn = {
            method: inputData.method,
        };
        if (functionsToCheck.includes(inputData.method)) {
            let pathIndex = inputData.names.indexOf('path');
            let pathValue = inputData.inputs[pathIndex];
            objToReturn.pathValue = pathValue;
            let tokenAcquistato = pathValue[1];
            if (!tokenAcquistato.startsWith('0x')) {
                tokenAcquistato = '0x' + tokenAcquistato;
            }
            tokenAcquistato = tokenAcquistato.toLowerCase();
            if (tokenToExclude.includes(tokenAcquistato)) return null;

            let deadlineIndex = inputData.names.indexOf('deadline');
            let deadlineValue = inputData.inputs[deadlineIndex];
            objToReturn.deadlineValue = deadlineValue;
            objToReturn.deadLineDate = new Date(parseInt(deadlineValue._hex) * 1000).toString();
            objToReturn.tokenAcquistato = tokenAcquistato;

            let amountOutMinIndex, amountOutValueIndex, amountOutMinValue, amountOutValue;
            switch (inputData.method) {
                case 'swapETHForExactTokens':
                    amountOutValueIndex = inputData.names.indexOf('amountOut');
                    amountOutValue = inputData.inputs[amountOutValueIndex];
                    objToReturn.amountOutValue = amountOutValue;
                    objToReturn.amountOutValueWei = BigInt(amountOutValue._hex).toString();
                    break;
                case 'swapExactETHForTokens':
                case 'swapExactETHForTokensSupportingFeeOnTransferTokens':
                    amountOutMinIndex = inputData.names.indexOf('amountOutMin');
                    amountOutMinValue = inputData.inputs[amountOutMinIndex];
                    objToReturn.amountOutMinValue = amountOutMinValue;
                    objToReturn.amountOutMinValueWei = BigInt(amountOutMinValue._hex).toString();
                    break;
            }
            return objToReturn;
        }
        return null;
    } catch (error) {
        console.error('Error decoding input data:', error);
        return null;
    }
};

module.exports = {
    getInputData: (web3Http, abis, transaction) => {
        if (!transaction) return null;
        let abi = null;
        if (transaction.to) {
            abi = abis.find(a => a.address.toLowerCase() === transaction.to.toLowerCase());
            if (!abi) return null;
        } else {
            return null;
        }

        try {
            const inputData = extractDataFromInput(web3Http, abi, transaction.input);
            if (!inputData) return null;
            return { transaction, inputData };
        } catch (error) {
            console.error('Error decoding input data:', error);
            return null;
        }
    }
};
