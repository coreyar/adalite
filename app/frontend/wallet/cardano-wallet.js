const cbor = require('cbor')
const base58 = require('cardano-crypto.js').base58

const debugLog = require('../helpers/debugLog')
const {generateMnemonic, validateMnemonic} = require('./mnemonic')
const {TxInputFromUtxo, TxOutput, TxAux} = require('./transaction')
const BlockchainExplorer = require('./blockchain-explorer')
const CardanoMnemonicCryptoProvider = require('./cardano-mnemonic-crypto-provider')
const CardanoTrezorCryptoProvider = require('./cardano-trezor-crypto-provider')
const PseudoRandom = require('./helpers/PseudoRandom')
const {HARDENED_THRESHOLD, MAX_INT32} = require('./constants')
const shuffleArray = require('./helpers/shuffleArray')
const range = require('./helpers/range')
const {toBip32StringPath} = require('./helpers/bip32')
const {parseTx} = require('./helpers/cbor-parsers')
const CborIndefiniteLengthArray = require('./helpers/CborIndefiniteLengthArray')
const parseMnemonicOrHdNodeString = require('./helpers/parseMnemonicOrHdNodeString')
const NamedError = require('../helpers/NamedError')

function txFeeFunction(txSizeInBytes) {
  const a = 155381
  const b = 43.946

  return Math.ceil(a + txSizeInBytes * b)
}

const CardanoWallet = async (options) => {
  const {mnemonicOrHdNodeString, config, randomSeed} = options

  const state = {
    randomSeed: randomSeed || Math.floor(Math.random() * MAX_INT32),
    ownUtxos: {},
    overallTxCountSinceLastUtxoFetch: 0,
    accountIndex: HARDENED_THRESHOLD,
    addressDerivationMode: 'hardened', // temporary - use it to switch between hardened and non-hardened addresses
  }

  const blockchainExplorer = BlockchainExplorer(config, state)

  let cryptoProvider = null
  if (options.cryptoProvider === 'trezor') {
    cryptoProvider = CardanoTrezorCryptoProvider(config, state)
  } else if (options.cryptoProvider === 'mnemonic') {
    cryptoProvider = CardanoMnemonicCryptoProvider(
      await parseMnemonicOrHdNodeString(mnemonicOrHdNodeString),
      state
    )
  } else {
    throw new Error(`Uknown crypto provider: ${options.cryptoProvider}`)
  }

  await discoverOwnAddresses()

  // fetch unspent outputs list asynchronously
  getUnspentTxOutputs()

  async function sendAda(address, coins) {
    const signedTx = await prepareSignedTx(address, coins)

    const response = await blockchainExplorer
      .submitTxRaw(signedTx.txHash, signedTx.txBody)
      .catch((e) => {
        debugLog(e)
        throw NamedError('TransactionRejectedByNetwork')
      })

    //TODO: refactor signing process so we dont need to reparse signed transaction for this
    const {txAux} = parseTx(Buffer.from(signedTx.txBody, 'hex'))
    updateUtxosFromTxAux(txAux)

    return response
  }

  function getSecret() {
    return cryptoProvider.getWalletSecret()
  }

  async function getId() {
    return await cryptoProvider.getWalletId()
  }

  async function prepareSignedTx(address, coins) {
    const txAux = await prepareTxAux(address, coins).catch((e) => {
      debugLog(e)
      throw NamedError('TransactionCorrupted')
    })

    const rawInputTxs = await Promise.all(
      txAux.inputs.map(({txHash}) => blockchainExplorer.fetchTxRaw(txHash))
    )

    const signedTx = await cryptoProvider.signTx(txAux, rawInputTxs).catch((e) => {
      debugLog(e)
      throw NamedError('TransactionRejected')
    })

    return signedTx
  }

  async function prepareTxAux(address, coins) {
    const txInputs = await prepareTxInputs(coins, address)
    const txInputsCoinsSum = txInputs.reduce((acc, elem) => acc + elem.coins, 0)
    const fee = computeTxFee(txInputs, coins, address)
    const changeAmount = txInputsCoinsSum - coins - fee

    if (changeAmount < 0) {
      throw Error(`
        Transaction inputs (sum ${txInputsCoinsSum}) don't cover coins (${coins}) + fee (${fee})`)
    }

    const txOutputs = [TxOutput(address, coins, false)]

    if (changeAmount > 0) {
      txOutputs.push(TxOutput(await getChangeAddress(), changeAmount, true))
    }

    return TxAux(txInputs, txOutputs, {})
  }

  async function getAllFundsTxFee(address) {
    const utxos = await getUnspentTxOutputs()
    const txInputs = []
    let coins = 0
    const witnessSize = 139
    let addedCost = 0
    let inputSize = 0

    for (let i = 0; i < utxos.length; i++) {
      inputSize = cbor.encode(TxInputFromUtxo(utxos[i])).length
      //txFeeFunction(0) returns just the static part of fee that needs to be paid anyway
      addedCost = txFeeFunction(inputSize + witnessSize) - txFeeFunction(0)
      if (utxos[i].coins < addedCost) {
        //if a given unspent output has less coins than what we would spend on fees to add
        //that unspent output, its better we skip it
        continue
      }
      txInputs.push(TxInputFromUtxo(utxos[i]))
      coins += utxos[i].coins
    }
    return computeTxFee(txInputs, coins, address)
  }

  async function getTxFee(coins, address) {
    const txInputs = await prepareTxInputs(coins, address)

    return computeTxFee(txInputs, coins, address)
  }

  async function getBalance() {
    const addresses = await discoverOwnAddresses()

    return await blockchainExplorer.getBalance(addresses)
  }

  async function getHistory() {
    const addresses = await discoverOwnAddresses()

    return await blockchainExplorer.getTxHistory(addresses)
  }

  async function fetchTxInfo(txHash) {
    return await blockchainExplorer.fetchTxInfo(txHash)
  }

  async function prepareTxInputs(coins, address) {
    // we do it pseudorandomly to guarantee fee computation stability
    const randomGenerator = PseudoRandom(state.randomSeed)
    const utxos = shuffleArray(await getUnspentTxOutputs(), randomGenerator)

    const txInputs = []
    let sumUtxos = 0
    let totalCoins = coins
    const witnessSize = 139
    let addedCost = 0
    let inputSize = 0

    for (let i = 0; i < utxos.length && sumUtxos < totalCoins; i++) {
      inputSize = cbor.encode(TxInputFromUtxo(utxos[i])).length
      //txFeeFunction(0) returns just the static part of fee that needs to be paid anyway
      addedCost = txFeeFunction(inputSize + witnessSize) - txFeeFunction(0)
      if (utxos[i].coins < addedCost) {
        //if a given unspent output has less coins than what we would spend on fees to add
        //that unspent output, its better we skip it
        continue
      }
      txInputs.push(TxInputFromUtxo(utxos[i]))
      sumUtxos += utxos[i].coins

      totalCoins = coins + computeTxFee(txInputs, totalCoins, address)
    }

    return txInputs
  }

  function computeTxFee(txInputs, coins, address) {
    if (coins > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Unsupported amount of coins: ${coins}`)
    }

    const txInputsCoinsSum = txInputs.reduce((acc, elem) => {
      return acc + elem.coins
    }, 0)

    //first we try one output transaction
    const oneOutputFee = txFeeFunction(estimateTxSize(txInputs, coins, address, false))

    /*
    * if (coins+oneOutputFee) is equal to (txInputsCoinsSum) it means there is no change necessary
    * if (coins+oneOutputFee) is bigger the transaction is invalid even with higher fee
    * so we let caller handle it
    */
    if (coins + oneOutputFee >= txInputsCoinsSum) {
      return oneOutputFee
    } else {
      //we try to compute fee for 2 output tx
      const twoOutputFee = txFeeFunction(estimateTxSize(txInputs, coins, address, true))
      if (coins + twoOutputFee > txInputsCoinsSum) {
        //means one output transaction was possible, while 2 output is not
        //so we return fee equal to inputs - coins which is guaranteed to pass
        return txInputsCoinsSum - coins
      } else {
        return twoOutputFee
      }
    }
  }

  function estimateTxSize(txInputs, coins, outAddress, hasChange) {
    const txInputsSize = cbor.encode(new CborIndefiniteLengthArray(txInputs)).length
    const outAddressSize = base58.decode(outAddress).length

    //size of addresses used by cardanolite
    const ownAddressSize = 76

    //size of one witness in Cardano transaction an array with Xpub and Singature
    const witnessSize = 139

    /*
    * we assume that at most two outputs (destination and change address) will be present
    * encoded in an indefinite length array
    */
    const maxCborCoinsLen = 9 //length of CBOR encoded 64 bit integer, currently max supported
    const txOutputsSize = hasChange
      ? outAddressSize + ownAddressSize + maxCborCoinsLen * 2 + 2
      : outAddressSize + maxCborCoinsLen + 2

    const txMetaSize = 1 // currently empty Map

    // the 1 is there for the CBOR "tag" for an array of 3 elements
    const txAuxSize = 1 + txInputsSize + txOutputsSize + txMetaSize

    const txWitnessesSize = txInputs.length * witnessSize + 1

    // the 1 is there for the CBOR "tag" for an array of 2 elements
    const txSizeInBytes = 1 + txAuxSize + txWitnessesSize

    /*
    * the deviation is there for the array of tx witnesses
    * because it may have more than 1 byte of overhead
    * if more than 16 elements are present
    */
    const deviation = 4

    return txSizeInBytes + deviation
  }

  async function getChangeAddress() {
    // if we used all available addresses return random address from the available ones
    const ownAddresses = await discoverOwnAddresses()
    const randomSeedGenerator = new PseudoRandom(state.randomSeed)

    return ownAddresses[randomSeedGenerator.nextInt() % ownAddresses.length]
  }

  async function getUnspentTxOutputs() {
    const addresses = await discoverOwnAddresses()
    const currentOverallTxCount = await blockchainExplorer.getOverallTxCount(addresses)

    if (state.overallTxCountSinceLastUtxoFetch < currentOverallTxCount) {
      const response = await blockchainExplorer.fetchUnspentTxOutputs(addresses)

      state.ownUtxos = Object.assign(
        {},
        ...response.map((elem) => ({[`${elem.txHash}_${elem.outputIndex}`]: elem}))
      )

      state.overallTxCountSinceLastUtxoFetch = currentOverallTxCount
    }

    return Object.values(state.ownUtxos)
  }

  async function discoverOwnAddresses() {
    const childIndexBegin = state.addressDerivationMode === 'hardened' ? HARDENED_THRESHOLD : 0
    const childIndexEnd = childIndexBegin + config.CARDANOLITE_WALLET_ADDRESS_LIMIT
    const derivationPaths = range(childIndexBegin, childIndexEnd).map((i) => [
      HARDENED_THRESHOLD,
      i,
    ])

    return await cryptoProvider.deriveAddresses(derivationPaths, state.addressDerivationMode)
  }

  async function getOwnAddressesWithMeta() {
    const addresses = await discoverOwnAddresses()

    return Promise.all(
      addresses.map(async (address) => {
        const derivationPath = await cryptoProvider.getDerivationPathFromAddress(address)
        const bip32StringPath = toBip32StringPath(derivationPath)
        return {
          address,
          bip32StringPath,
        }
      })
    )
  }

  async function isOwnAddress(addr) {
    const addresses = await discoverOwnAddresses()
    return addresses.find((address) => address === addr) !== undefined
  }

  function updateUtxosFromTxAux(txAux) {
    const spentUtxos = txAux.inputs.map((elem) => elem.utxo)
    discardUtxos(spentUtxos)

    const newUtxos = txAux.outputs.filter((elem) => isOwnAddress(elem.address)).map((elem, i) => {
      return {
        address: elem.address,
        coins: elem.coins,
        txHash: txAux.getId(),
        outputIndex: i,
      }
    })

    addUtxos(newUtxos)
    state.overallTxCountSinceLastUtxoFetch++

    // shift randomSeed for next unspent outputs selection
    const randomSeedGenerator = new PseudoRandom(state.randomSeed)
    for (let i = 0; i < spentUtxos.length; i++) {
      state.randomSeed = randomSeedGenerator.nextInt()
    }
  }

  function discardUtxos(utxos) {
    utxos.map((utxo) => {
      delete state.ownUtxos[`${utxo.txHash}_${utxo.outputIndex}`]
    })
  }

  function addUtxos(utxos) {
    utxos.map((utxo) => {
      state.ownUtxos[`${utxo.txHash}_${utxo.outputIndex}`] = utxo
    })
  }

  return {
    getId,
    getSecret,
    sendAda,
    getBalance,
    getChangeAddress,
    getAllFundsTxFee,
    getTxFee,
    _prepareSignedTx: prepareSignedTx,
    getHistory,
    isOwnAddress,
    getOwnAddressesWithMeta,
    _prepareTxAux: prepareTxAux,
    verifyAddress: cryptoProvider.trezorVerifyAddress,
    fetchTxInfo,
  }
}

if (typeof window !== 'undefined') {
  window.CardanoWallet = exports.CardanoWallet
}

module.exports = {
  CardanoWallet,
  generateMnemonic,
  validateMnemonic,
  txFeeFunction,
}
