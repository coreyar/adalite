import {h, Component} from 'preact'
import {connect} from '../../../helpers/connect'
import actions from '../../../actions'
import Balance from '../../common/balance'
import TransactionHistory from './transactionHistory'
import ExportCard from '../exportWallet/exportCard'
import SendAdaPage from '../sendAda/sendAdaPage'
import MyAddresses from '../receiveAda/myAddresses'
import DelegatePage from '../delegations/delegatePage'
import CurrentDelegationPage from '../delegations/currentDelegationPage'
// import DelegationHistory from '../delegations/delegationHistory'
import StakingPageToggle from '../../common/stakingPageToggle'
import ShelleyBalances from '../delegations/shelleyBalances'
import {ADALITE_CONFIG} from '.././../../config'
import Tabs from './tabs'

interface Props {
  transactionHistory: any
  // delegationHistory: any
  displayStakingPage: any
}

// TODO make dict of tabs for mobile n stakin/send

const StakingTab = () => {
  return (
    <div className="dashboard desktop">
      <div className="dashboard-column">
        <ShelleyBalances />,
        <CurrentDelegationPage />
      </div>
      <div className="dashboard-column">
        <DelegatePage />,
        {/* <DelegationHistory /> */}
      </div>
    </div>
  )
}

const SendAdaTab = ({
  balance,
  transactionHistory,
  // delegationHistory,
  reloadWalletInfo,
  conversionRates,
  // showExportOption,
  // displayStakingPage,
}) => {
  return (
    <div className="dashboard desktop">
      <div className="dashboard-column">
        <Balance
          balance={balance}
          reloadWalletInfo={reloadWalletInfo}
          conversionRates={conversionRates}
        />,
        <TransactionHistory transactionHistory={transactionHistory} />,
      </div>
      <div className="dashboard-column">
        <SendAdaPage />,
        <MyAddresses />,
        <ExportCard />
      </div>
    </div>
  )
}

const DashboardTab = (tabName, tabText) => (
  <li className={`dashboard-tab ${'selected'}`} onClick={() => this.changeTab(tabName)}>
    {tabText}
  </li>
)

class TxHistoryPage extends Component<Props> {
  //TODO rename to wallet or dashboard
  constructor(props) {
    super(props)
    this.state = {selectedTab: 'transactions'}
    // this.changeTab = this.changeTab.bind(this)
  }

  render({
    balance,
    transactionHistory,
    // delegationHistory,
    reloadWalletInfo,
    conversionRates,
    showExportOption,
    displayStakingPage,
  }) {
    return (
      <div className="page-wrapper">
        {ADALITE_CONFIG.ADALITE_CARDANO_VERSION === 'shelley' && (
          // <ul>
          // <DashboardTab tabName="ahoj" tabText="seruz"/>
          // </ul>
          <Tabs />
        )}
        <div className="dashboard desktop">
          {!displayStakingPage ? (
            <SendAdaTab
              balance={balance}
              transactionHistory={transactionHistory}
              reloadWalletInfo={reloadWalletInfo}
              conversionRates={conversionRates}
            />
          ) : (
            <StakingTab />
          )}
          {/* <div className="dashboard-column">
          {displayStakingPage
            ? [<ShelleyBalances />, <CurrentDelegationPage />]
            : [
              <Balance
                balance={balance}
                reloadWalletInfo={reloadWalletInfo}
                conversionRates={conversionRates}
              />,
              <TransactionHistory transactionHistory={transactionHistory} />,
            ]}
        </div>
        <div className="dashboard-column">
          {displayStakingPage
            ? [
              <DelegatePage />,
              // <DelegationHistory />
            ]
            : [<SendAdaPage />, <MyAddresses />, showExportOption && <ExportCard />]}
        </div> */}
        </div>
        <div className="dashboard mobile">
          {displayStakingPage ? (
            <ShelleyBalances />
          ) : (
            <Balance
              balance={balance}
              reloadWalletInfo={reloadWalletInfo}
              conversionRates={conversionRates}
            />
          )}
          <DashboardMobileContent
            transactionHistory={transactionHistory}
            // delegationHistory={delegationHistory}
            displayStakingPage={displayStakingPage}
          />
          {!displayStakingPage && showExportOption && <ExportCard />}
        </div>
      </div>
    )
  }
}

class DashboardMobileContent extends Component<Props> {
  constructor(props) {
    super(props)
    this.state = {selectedTab: 'transactions'}
    this.changeTab = this.changeTab.bind(this)
  }
  changeTab(tabName) {
    this.setState({selectedTab: tabName})
  }
  render({transactionHistory, delegationHistory, displayStakingPage}, {selectedTab}) {
    const dashboardTab = (tabName, tabText) => (
      <li
        className={`dashboard-tab ${tabName === selectedTab ? 'selected' : ''}`}
        onClick={() => this.changeTab(tabName)}
      >
        {tabText}
      </li>
    )

    const stakingTabs = ['delegate', 'delegation-history', 'current-delegation']
    const sendingTabs = ['send', 'transactions', 'receive']

    if (displayStakingPage && sendingTabs.includes(selectedTab)) {
      this.changeTab('delegate')
    }
    if (!displayStakingPage && stakingTabs.includes(selectedTab)) {
      this.changeTab('transactions')
    }

    return (
      <div className="dashboard-content">
        <ul className="dashboard-tabs">
          {displayStakingPage
            ? [
              dashboardTab('delegate', 'Delegate ADA'),
              dashboardTab('current-delegation', 'Current Delegation'),
              // dashboardTab('delegation-history', 'Delegation History'),
            ]
            : [
              dashboardTab('transactions', 'Transactions'),
              dashboardTab('send', 'Send ADA'),
              dashboardTab('receive', 'Receive ADA'),
            ]}
        </ul>
        {displayStakingPage
          ? [
            selectedTab === 'delegate' && <DelegatePage />,
            // selectedTab === 'delegation-history' && <DelegationHistory />,
            selectedTab === 'current-delegation' && <CurrentDelegationPage />,
          ]
          : [
            selectedTab === 'send' && <SendAdaPage />,
            selectedTab === 'transactions' && (
              <TransactionHistory transactionHistory={transactionHistory} />
            ),
            selectedTab === 'receive' && <MyAddresses />,
          ]}
      </div>
    )
  }
}

const TxHistoryPage2 = connect(
  (state) => ({
    transactionHistory: state.transactionHistory,
    conversionRates: state.conversionRates && state.conversionRates.data,
    showExportOption: state.showExportOption,
    displayStakingPage: state.displayStakingPage,
    balance: state.balance,
  }),
  actions
)(
  ({
    balance,
    transactionHistory,
    delegationHistory,
    reloadWalletInfo,
    conversionRates,
    showExportOption,
    displayStakingPage,
  }) => (
    <div className="page-wrapper">
      {ADALITE_CONFIG.ADALITE_CARDANO_VERSION === 'shelley' && <StakingPageToggle />}
      <div className="dashboard desktop">
        <div className="dashboard-column">
          {displayStakingPage
            ? [<ShelleyBalances />, <CurrentDelegationPage />]
            : [
              <Balance
                balance={balance}
                reloadWalletInfo={reloadWalletInfo}
                conversionRates={conversionRates}
              />,
              <TransactionHistory transactionHistory={transactionHistory} />,
            ]}
        </div>
        <div className="dashboard-column">
          {displayStakingPage
            ? [
              <DelegatePage />,
              // <DelegationHistory />
            ]
            : [<SendAdaPage />, <MyAddresses />, showExportOption && <ExportCard />]}
        </div>
      </div>
      <div className="dashboard mobile">
        {displayStakingPage ? (
          <ShelleyBalances />
        ) : (
          <Balance
            balance={balance}
            reloadWalletInfo={reloadWalletInfo}
            conversionRates={conversionRates}
          />
        )}
        <DashboardMobileContent
          transactionHistory={transactionHistory}
          // delegationHistory={delegationHistory}
          displayStakingPage={displayStakingPage}
        />
        {!displayStakingPage && showExportOption && <ExportCard />}
      </div>
    </div>
  )
)

export default connect(
  (state) => ({
    transactionHistory: state.transactionHistory,
    conversionRates: state.conversionRates && state.conversionRates.data,
    showExportOption: state.showExportOption,
    displayStakingPage: state.displayStakingPage,
    balance: state.balance,
  }),
  actions
)(TxHistoryPage)
