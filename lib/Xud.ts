import Logger from 'lib/Logger';
import Config from 'lib/Config';
import DB from 'lib/db/DB';
import OrderBook from 'lib/orderbook/OrderBook';
import LndClient from 'lib/lndclient/LndClient';
import RaidenClient from 'lib/raidenclient/RaidenClient';
import RpcServer from 'lib/rpc/RpcServer';
import P2P from 'lib/p2p/P2P';
import P2PServer from 'lib/p2p/P2PServer';

/** Class representing a complete Exchange Union daemon. */
class Xud {
  logger: any;
  config: any;
  db: any;
  lndClient: any;
  raidenClient: any;
  p2p: any;
  p2pServer: any;
  orderBook: any;
  rpcServer: any;

  /**
   * Create an Exchange Union daemon.
   * @param {Object} args - Optional command line arguments to override configuration parameters.
   */
  constructor(args) {
    this.logger = Logger.global;
    this.config = new Config(args);

    this.shutdown = this.shutdown.bind(this);
  }

  /**
   * Start all processes necessary for the operation of an Exchange Union node.
   */
  async start() {
    await this.config.load();
    this.logger.info('config loaded');

    try {
      this.db = new DB(this.config.db);
      await this.db.init();

      this.lndClient = new LndClient(this.config.lnd);
      this.raidenClient = new RaidenClient(this.config.raiden);

      this.p2p = new P2P(this.db);
      if (this.config.p2p.listen) {
        this.p2pServer = new P2PServer(this.p2p);
        await this.p2pServer.listen(this.config.p2p.port);
      }

      this.orderBook = new OrderBook(this.db, this.p2p);
      await this.orderBook.init();

      this.rpcServer = new RpcServer({
        orderBook: this.orderBook,
        lndClient: this.lndClient,
        raidenClient: this.raidenClient,
        p2p: this.p2p,
        shutdown: this.shutdown,
      });
      await this.rpcServer.listen(this.config.rpc.port);
    } catch (err) {
      this.logger.error(err);
    }
  }

  /**
   * Gracefully end all running processes and disconnects from peers.
   */
  async shutdown() {
    // ensure we stop listening for new peers before disconnecting from peers
    if (this.p2pServer) {
      this.p2pServer.close();
    }
    this.p2p.closeAllConnections();

    // TODO: ensure we are not in the middle of executing any trades

    const msg = 'XUD shutdown gracefully';
    (async () => {
      // we use an immediately invoked function here to close rpcServer and exit process AFTER the
      // shutdown method returns a response.
      await this.rpcServer.close();
      this.logger.info(msg);
      this.db.close();
    })();

    return msg;
  }
}

if (!module.parent) {
  const xud = new Xud(null);
  xud.start();
}

export default Xud;
