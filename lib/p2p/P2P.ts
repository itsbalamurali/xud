const net: any = require('net');

import { EventEmitter } from 'events';
import assert from 'assert';
import dns from 'dns';

import Peer from './Peer';
import P2PRepository from './P2PRepository';
import Logger from 'lib/Logger';

const nodePubKey = `tempPK_${Math.floor(1000 + (Math.random() * 9000))}`;

/** Class representing a pool of XU peers */
class P2P extends EventEmitter {
  logger: any;
  peers: any;
  server: any;
  connectionListener: any;
  repository: P2PRepository;

  /**
   * Create a pool of XU peers.
   */
  constructor(db) {
    super();
    this.logger = Logger.global;
    this.repository = new P2PRepository(db);
    this.peers = {};

    this.server = net.createServer(this.connectionListener);
    this.server.on('error', (err) => {
      this.logger.error(err);
    });
  }

  /**
   * Broadcast a message to all peers.
   * @param {string} type - The type of message to broadcast.
   * @param {Object} object - The JSON body of the message to be converted and sent as a string.
   */
  async broadcast(type, object) {
    const peerKeys = Object.keys(this.peers);
    for (let n = 0; n < peerKeys.length; n += 1) {
      this.peers[peerKeys[n]].write(`${type} ${JSON.stringify(object)}\r\n`);
    }
  }

  /**
   * Connect to an XU peer on a given host and port.
   * @param {string} host
   * @param {number} port
   */
  connect(host, port) {
    return new Promise((resolve, reject) => {
      dns.lookup(host, (dnsErr, address) => {
        if (dnsErr) {
          resolve(`could not resolve ${host}`);
          return;
        }

        const peer = new Peer({ host, address, port });
        if (this.peers[peer.getKey()]) {
          resolve(`peer ${peer.toString()} is already connected`);
          return;
        }

        const socket = net.connect({
          address,
          port,
        }, async () => {
          await this.addPeer(peer, socket);
          const msg = `connected to peer ${peer.toString()}`;
          this.logger.debug(msg);
          resolve(msg);
        });
        socket.once('error', (err) => {
          reject(err);
        });
      });
    });
  }

  /**
   * Close all connections to peers.
   */
  closeAllConnections() {
    const peerKeys = Object.keys(this.peers);
    for (let n = 0; n < peerKeys.length; n += 1) {
      const peer = this.peers[peerKeys[n]];
      if (peer) {
        peer.destroy();
      }
    }
  }

  /**
   * Add a peer to the list of peers and set handlers for socket events.
   * @param {Peer} peer
   * @param {net.Socket} socket
   */
  async addPeer(peer, socket) {
    const key = peer.getKey();
    assert(!this.peers[key], `peer ${peer.toString()} is already connected`);

    const dbPeer = await this.repository.getOrAddPeer(peer.address, peer.port);
    this.peers[key] = socket;

    socket.on('end', () => {
      this.peers[key] = null;
      this.logger.debug(`peer ${peer.toString()} disconnected`);
    });

    socket.on('data', (data) => {
      const dataStr = data.toString();
      this.logger.debug(`received data from ${peer.toString()}: ${dataStr}`);
      const type = dataStr.split(' ', 1)[0];
      try {
        const obj = JSON.parse(dataStr.substring(type.length + 1));

        switch (type) {
          case 'neworder': {
            const { pubKey, order } = obj;
            this.emit(type, { pubKey, order: { ...order, peerId: dbPeer.id } });
            break;
          }
          default:
            // TODO ban peers for repeated bad p2p messages
            this.logger.warn(`unknown p2p message type: ${type}`);
        }
      } catch (err) {
        // TODO ban peers for repeated bad p2p messages
        this.logger.warn(`could not parse p2p emssage: ${dataStr}`);
      }
    });

    socket.on('error', (err) => {
      this.peers[key] = null;
      this.logger.debug(`error with connection to peer ${peer.toString()}: ${err}`);
    });
  }

  broadcastOrder(order) {
    this.broadcast('neworder', { order, pubKey: nodePubKey });
  }
}

export default P2P;
