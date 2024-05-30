# Ethereum Flashbots Arbitrage Script

This script is designed to perform arbitrage on the Ethereum network using Flashbots. It identifies potential transactions on the mainnet, simulates them on a testnet (Goerli), and if successful, executes them on the mainnet to profit from price differences.

## Features

- **Transaction Monitoring**: Monitors Ethereum transactions and identifies profitable arbitrage opportunities.
- **Flashbots Integration**: Utilizes Flashbots for efficient and private transaction bundling.
- **Simulation on Testnet**: Simulates transactions on Goerli testnet before executing on the mainnet to minimize risk.
- **Dynamic Investment Calculation**: Automatically calculates the amount of ETH to invest based on wallet balance and desired investment percentage.

## Prerequisites

- Node.js (v14 or higher)
- npm
- Ethereum wallet with sufficient funds
- Accounts on Infura, Alchemy, or another Ethereum provider
- Access to Flashbots

## Installation

1. **Clone the repository:**

    ```bash
    git clone https://github.com/simonedoria/thorin-scudodiquercia.git
    cd thorin-scudodiquercia
    ```

2. **Install dependencies:**

    ```bash
    npm install
    ```

3. **Set up your environment variables:**

    Create a `.env` file in the root directory of the project with the following content:

    ```plaintext
    # Etherscan API key
    ETHERSCAN_API_KEY=<your_etherscan_api_key>
    # Ethereum mainnet provider
    PROVIDER_WS=<your_infura_or_other_ws_url>
    PROVIDER_HTTP=<your_infura_or_other_http_url>
    # Your wallet keys
    PRIVATE_KEY=<your_wallet_private_key>
    MY_ADDRESS=<your_wallet_address>
    # Flashbots URL
    FLASHBOTS_URL=https://relay.flashbots.net
    ```

## Obtaining Environment Variables

### Etherscan API Key

1. **Sign up for an account on [Etherscan](https://etherscan.io/).**
2. **Navigate to the API Keys section of your account settings.**
3. **Create a new API key and copy it into the `ETHERSCAN_API_KEY` field in your `.env` file.**

### Ethereum Provider URLs

You can use services like Infura, Alchemy, or others to obtain your Ethereum provider URLs.

#### Infura

1. **Sign up for an account on [Infura](https://infura.io/).**
2. **Create a new project and select Ethereum as the network.**
3. **Copy the provided WebSocket URL and HTTP URL into the `PROVIDER_WS` and `PROVIDER_HTTP` fields in your `.env` file, respectively.**

## OR

#### Alchemy

1. **Sign up for an account on [Alchemy](https://www.alchemy.com/).**
2. **Create a new app and select Ethereum as the network.**
3. **Copy the provided WebSocket URL and HTTP URL into the `PROVIDER_WS` and `PROVIDER_HTTP` fields in your `.env` file, respectively.**

### Wallet Private Key and Address

1. **Ensure you have an Ethereum wallet (e.g., MetaMask, MyEtherWallet).**
2. **Export the private key from your wallet and copy it into the `PRIVATE_KEY` field in your `.env` file.**
3. **Copy your wallet address into the `MY_ADDRESS` field in your `.env` file.**

### Flashbots URL

Use the Flashbots relay URL for submitting bundles:

```plaintext
FLASHBOTS_URL=https://relay.flashbots.net
  ```
For testing on the Goerli testnet, use:

```plaintext
FLASHBOTS_URL=https://relay-goerli.flashbots.net
  ```

**Running the Script**
Ensure your .env file is correctly configured.

Run the script:

    ```bash
    node app.js
    ```
    
## Additional Configuration

### Dynamic Investment Calculation

The script calculates the amount of ETH to invest dynamically based on your wallet balance. You can adjust the investment percentage in the script by modifying the `calculateEthToInvest` function.

### Simulation on Goerli Testnet

The script first simulates the transactions on the Goerli testnet before executing them on the mainnet. Ensure you have sufficient test ETH on Goerli, which you can obtain from [Goerli Faucets](https://faucet.goerli.mudit.blog/).

## Notes

- **Security**: Never share your private keys or `.env` file with anyone.
- **Testing**: Always test your script on a testnet (like Goerli) before deploying it on the mainnet.
- **Flashbots**: Familiarize yourself with Flashbots and their documentation for best practices and advanced usage.

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.

---

Feel free to open issues or contribute to this project. Happy arbitraging!
