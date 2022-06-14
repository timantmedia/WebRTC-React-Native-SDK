import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  MutableRefObject,
} from 'react';

import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  MediaStream,
  MediaStreamTrack,
  mediaDevices,
  registerGlobals,
  RTCView,
} from 'react-native-webrtc';

//Interfaces
export interface Params {
  url: string;
  mediaConstraints: any;
  callback(this: Adaptor, message: string, data?: any): void;
  callbackError?: (errorMessage: string, data?: any) => void;
  peer_connection_config?: any;
  debug?: boolean;
}
export interface RemoteStreams {
  [key: string]: MediaStream;
}
export interface Adaptor {
  publish: (streamId: string, token?: string) => void;
  play: (streamId: string, token?: string, room?: string) => void;
  stop: (streamId: string) => void;
  join: (streamId: string) => void;
  leave: (streamId: string) => void;
  joinRoom: (room: string, streamId?: string) => void;
  leaveFromRoom: (room: string) => void;
  getRoomInfo: (room: string, streamId?: string) => void;
  initPeerConnection: (streamId: string) => Promise<void>;
  localStream: MutableRefObject<MediaStream | null>;
  remoteStreams: RemoteStreams;
}
export interface RemotePeerConnection {
  [key: string]: RTCPeerConnection;
}
export interface RemotePeerConnectionStats {
  [key: string]: { timerId: number };
}

export interface RemoteDescriptionSet {
  [key: string]: boolean;
}
export interface IceCandidateList {
  [key: string]: RTCIceCandidate[];
}

//useAntMedia main adaptor function
export function useAntMedia(params: Params) {
  const {
    url,
    mediaConstraints,
    callbackError,
    callback,
    peer_connection_config,
    debug,
  } = params;

  const [roomName, setRoomName] = useState('');

  const adaptorRef: any = useRef<null | Adaptor>(null);

  let localStream: any = useRef(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStreams>({});

  const remotePeerConnection = useRef<RemotePeerConnection>({}).current;
  const remotePeerConnectionStats = useRef<RemotePeerConnectionStats>(
    {}
  ).current;

  const remoteDescriptionSet = useRef<RemoteDescriptionSet>({}).current;
  const iceCandidateList = useRef<IceCandidateList>({}).current;

  const config: any = peer_connection_config;

  const playStreamIds = useRef<string[]>([]).current;

  const closePeerConnection = useCallback(
    (streamId: string) => {
      if (remotePeerConnection[streamId] != null) {
        // @ts-ignore
        if (remotePeerConnection[streamId].dataChannel != null)
          // @ts-ignore
          remotePeerConnection[streamId].dataChannel.close();

        setRemoteStreams((value: any) => {
          const val = { ...value };
          const streams = [...remotePeerConnection[streamId].getLocalStreams()];
          streams.forEach((stream) => {
            if (localStream.current?.toURL() !== stream.toURL()) {
              delete val[stream.toURL()];
            }
          });
          return val;
        });

        if (remotePeerConnection[streamId].signalingState !== 'closed') {
          remotePeerConnection[streamId].close();
          // @ts-ignore;
          remotePeerConnection[streamId] = null;

          delete remotePeerConnection[streamId];
          const playStreamIndex = playStreamIds.indexOf(streamId);

          if (playStreamIndex !== -1) {
            playStreamIds.splice(playStreamIndex, 1);
          }
        }
      }

      if (remotePeerConnectionStats[streamId] != null) {
        clearInterval(remotePeerConnectionStats[streamId].timerId);
        delete remotePeerConnectionStats[streamId];
      }
    },
    [playStreamIds, remotePeerConnection, remotePeerConnectionStats]
  );

  const iceCandidateReceived = useCallback(
    (event: any, streamId: string) => {
      if (event.candidate) {
        const jsCmd = {
          command: 'takeCandidate',
          streamId,
          label: event.candidate.sdpMLineIndex,
          id: event.candidate.sdpMid,
          candidate: event.candidate.candidate,
        };

        if (ws) ws.sendJson(jsCmd);
      }
    },
    [ws]
  );

  const onTrack = useCallback(
    (event: any, streamId: string) => {
      if (!remoteStreams[streamId]) {
        setRemoteStreams((dt) => {
          dt[streamId] = event.streams[0];
          return dt;
        });
        const dataObj = {
          track: event.streams[0],
          streamId,
        };
        if (adaptorRef.current)
          callback.call(adaptorRef.current, 'newStreamAvailable', dataObj);
      }
    },
    [callback, remoteStreams]
  );

  const initPeerConnection = useCallback(
    async (streamId: string) => {
      if (debug) console.log('in initPeerConnection');

      if (remotePeerConnection[streamId] == null) {
        const closedStreamId = streamId;
        remotePeerConnection[streamId] = new RTCPeerConnection(
          config || {
            iceServers: [],
          }
        );
        remoteDescriptionSet[streamId] = false;
        iceCandidateList[streamId] = [];

        if (!playStreamIds.includes(streamId) && localStream.current) {
          remotePeerConnection[streamId].addStream(localStream.current);
        }

        try {
          remotePeerConnection[streamId].onicecandidate = (event: any) => {
            iceCandidateReceived(event, closedStreamId);
          };
          // @ts-ignore
          remotePeerConnection[streamId].ontrack = (event: any) => {
            //if (debug) console.log('onTrack', event);
            onTrack(event, closedStreamId);
          };

          remotePeerConnection[streamId].onaddstream = () => {
            setRemoteStreams((value) => {
              const val = { ...value };
              const streams = [
                ...remotePeerConnection[streamId].getLocalStreams(),
                ...remotePeerConnection[streamId].getRemoteStreams(),
              ];
              streams.forEach((stream) => {
                if (localStream.current?.toURL() !== stream.toURL()) {
                  val[stream.toURL()] = stream;
                }
              });
              return val;
            });
          };
        } catch (err: any) {
          if (debug) console.error('initPeerConnectionError', err.message);
        }
      }
    },
    [
      config,
      debug,
      iceCandidateList,
      iceCandidateReceived,
      onTrack,
      playStreamIds,
      remoteDescriptionSet,
      remotePeerConnection,
    ]
  );

  const gotDescription = useCallback(
    async (configuration: any, streamId: string) => {
      try {
        if (debug) console.log('in gotDescription');

        // const response =
        await remotePeerConnection[streamId].setLocalDescription(configuration);

        const jsCmd = {
          command: 'takeConfiguration',
          streamId,
          type: configuration.type,
          sdp: configuration.sdp,
        };

        if (ws) ws.sendJson(jsCmd);
      } catch (err: any) {
        if (debug) console.log('gotDescriptionError', err);
      }
    },
    [debug, remotePeerConnection, ws]
  );

  const startPublishing = useCallback(
    async (streamId: string) => {
      try {
        if (debug) console.log('in start publishing');

        await initPeerConnection(streamId);
        const configuration = await remotePeerConnection[streamId].createOffer(
          config
        );
        await gotDescription(configuration, streamId);
      } catch (err: any) {
        if (debug) console.log('startPublishing error', err.message, err.stack);
      }
    },
    [config, debug, gotDescription, initPeerConnection, remotePeerConnection]
  );

  const addIceCandidate = useCallback(
    async (streamId: string, candidate: any) => {
      try {
        if (debug) console.log('in addIceCandidate');

        if (debug) console.debug(`addIceCandidate ${streamId}`);
        if (debug) console.debug('candidate', candidate);
        await remotePeerConnection[streamId].addIceCandidate(candidate);
      } catch (err) {}
    },
    [debug, remotePeerConnection]
  );

  const takeConfiguration = useCallback(
    async (idOfStream: string, configuration, typeOfConfiguration) => {
      const streamId = idOfStream;
      const type = typeOfConfiguration;
      const conf = configuration;
      const isTypeOffer = type === 'offer';

      if (debug) console.log('in takeConfiguration');

      await initPeerConnection(streamId);
      try {
        await remotePeerConnection[streamId].setRemoteDescription(
          new RTCSessionDescription({
            sdp: conf,
            type,
          })
        );

        remoteDescriptionSet[streamId] = true;
        const { length } = Object.keys(iceCandidateList[streamId]);

        for (let i = 0; i < length; i++) {
          await addIceCandidate(streamId, iceCandidateList[streamId][i]);
        }
        iceCandidateList[streamId] = [];

        if (isTypeOffer) {
          const configur = await remotePeerConnection[streamId].createAnswer(
            conf
          );
          await gotDescription(configur, streamId);
        }
      } catch (error: any) {
        if (
          error.toString().indexOf('InvalidAccessError') > -1 ||
          error.toString().indexOf('setRemoteDescription') > -1
        ) {
          /**
           * This error generally occurs in codec incompatibility.
           * AMS for a now supports H.264 codec. This error happens when some browsers try to open it from VP8.
           */
          if (callbackError) callbackError('notSetRemoteDescription');
        }
      }
    },
    [
      addIceCandidate,
      callbackError,
      debug,
      gotDescription,
      iceCandidateList,
      initPeerConnection,
      remoteDescriptionSet,
      remotePeerConnection,
    ]
  );

  const takeCandidate = useCallback(
    async (idOfTheStream: string, tmpLabel, tmpCandidate, sdpMid) => {
      if (debug) console.log('in takeCandidate');

      const streamId = idOfTheStream;
      const label = tmpLabel;
      const candidateSdp = tmpCandidate;

      const candidate = new RTCIceCandidate({
        sdpMLineIndex: label,
        candidate: candidateSdp,
        sdpMid,
      });

      await initPeerConnection(streamId);

      if (remoteDescriptionSet[streamId] === true) {
        await addIceCandidate(streamId, candidate);
      } else {
        if (debug)
          console.debug(
            'Ice candidate is added to list because remote description is not set yet'
          );
        const index = iceCandidateList[streamId].findIndex(
          (i) => JSON.stringify(i) === JSON.stringify(candidate)
        );
        if (index === -1) {
          const keys = Object.keys(candidate);
          for (const key in keys) {
            // @ts-ignore
            if (candidate[key] === undefined || candidate[key] === '') {
              // @ts-ignore
              candidate[key] = null;
            }
          }
          iceCandidateList[streamId].push(candidate);
        }
      }
    },
    [
      addIceCandidate,
      debug,
      iceCandidateList,
      initPeerConnection,
      remoteDescriptionSet,
    ]
  );

  var ws: any = useRef(new WebSocket(url)).current;

  ws.sendJson = (dt: any) => {
    ws.send(JSON.stringify(dt));
  };

  useEffect(() => {
    ws.onopen = () => {
      if (debug) console.log('web socket opened !');

      // connection opened

      mediaDevices
        .getUserMedia(mediaConstraints)
        .then((stream: any) => {
          // Got stream!
          if (debug) console.log('got stream');

          localStream.current = stream;

          if (debug) console.log('in stream', localStream.current);
        })
        .catch((error: any) => {
          // Log error

          if (debug) console.log('got error', error);
        });

      ws.sendJson({
        command: 'ping',
      });
    };

    ws.onmessage = (e: any) => {
      // a message was received
      const data = JSON.parse(e.data);

      switch (data.command) {
        case 'start':
          console.log(' in start', data);
          // start  publishing
          startPublishing(data.streamId);
          break;
        case 'takeCandidate':
          //console.log(' in takeCandidate', data);
          takeCandidate(data.streamId, data.label, data.candidate, data.id);
          break;
        case 'takeConfiguration':
          takeConfiguration(data.streamId, data.sdp, data.type);
          break;
        case 'stop':
          if (debug) console.log(' in stop', data);
          closePeerConnection(data.streamId);
          break;
        case 'error':
          if (debug) console.log(' in error', data);
          if (callbackError) {
            callbackError(data.definition, data);
          }
          break;
        case 'notification':
          if (debug) console.log(' in notification', data);

          var definition = data.definition;

          if (debug) console.log('definition', definition);

          if (definition === 'publish_started') {
          } else if (definition === 'publish_finished') {
            if (debug) console.log('InCallManager stopped');
          }

          callback.call(adaptorRef.current, data.definition, data);

          break;
        case 'streamInformation':
          if (debug) console.log(' in streamInformation', data);
          break;
        case 'pong':
          if (debug) console.log(' in pong', data);
          break;
      }
    };

    ws.onerror = (e: any) => {
      // an error occurred
      if (debug) console.log(e.message);
    };

    ws.onclose = (e: any) => {
      // connection closed
      if (debug) console.log(e.code, e.reason);
    };
  }, [
    callback,
    callbackError,
    closePeerConnection,
    config,
    debug,
    mediaConstraints,
    startPublishing,
    takeCandidate,
    takeConfiguration,
    ws,
  ]);

  //publish
  const publish = useCallback(
    (streamId: any, token: any) => {
      if (!localStream.current) return;
      const data = {
        command: 'publish',
        streamId,
        token,
        video: localStream.current.getVideoTracks().length > 0,
        audio: localStream.current.getAudioTracks().length > 0,
      };

      if (ws) ws.sendJson(data);
    },
    [ws]
  );

  //play
  const play = useCallback(
    (streamId: string, token?: string, room?: string) => {
      playStreamIds.push(streamId);
      const data = {
        command: 'play',
        streamId,
        token,
        room,
      };

      if (token) {
        data.token = token;
      }

      if (ws) ws.sendJson(data);
    },
    [playStreamIds, ws]
  );

  const stop = useCallback(
    (streamId: any) => {
      const data = {
        command: 'stop',
        streamId: streamId,
      };
      if (ws) ws.sendJson(data);
    },
    [ws]
  );

  const join = useCallback(
    (streamId: string) => {
      const data = {
        command: 'join',
        streamId,
      };
      if (ws) ws.sendJson(data);
    },
    [ws]
  );

  const leave = useCallback(
    (streamId: string) => {
      const data = {
        command: 'leave',
        streamId,
      };
      if (ws) ws.sendJson(data);
    },
    [ws]
  );

  const joinRoom = useCallback(
    (room: string, streamId?: string) => {
      const data = {
        command: 'joinRoom',
        room,
        streamId,
      };
      setRoomName(room);

      if (ws) ws.sendJson(data);
    },
    [ws]
  );

  const leaveFromRoom = useCallback(
    (room: string) => {
      const data = {
        command: 'leaveFromRoom',
        room,
      };
      setRoomName(room);
      if (ws) ws.sendJson(data);
    },
    [ws]
  );

  const getRoomInfo = useCallback(
    (room: string, streamId?: string) => {
      var data = {
        command: 'getRoomInfo',
        streamId,
        room,
      };
      if (ws) ws.sendJson(data);
    },
    [ws]
  );

  //adaptor ref
  useEffect(() => {
    adaptorRef.current = {
      publish,
      play,
      stop,
      join,
      leave,
      joinRoom,
      leaveFromRoom,
      getRoomInfo,
      initPeerConnection,
      localStream,
      remoteStreams,
    };
  }, [
    publish,
    play,
    stop,
    localStream,
    remoteStreams,
    join,
    leave,
    joinRoom,
    leaveFromRoom,
    getRoomInfo,
    initPeerConnection,
  ]);

  return {
    publish,
    play,
    stop,
    localStream,
    remoteStreams,
    join,
    leave,
    joinRoom,
    leaveFromRoom,
    getRoomInfo,
    initPeerConnection,
  } as Adaptor;
} // useAntmedia fn end

export function rtc_view(
  stream: any,
  customStyles: any = { width: '70%', height: '50%', alignSelf: 'center' }
) {
  const props = {
    streamURL: stream,
    style: customStyles,
  };

  return <RTCView {...props} />;
}
