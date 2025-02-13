import Dagre from '@dagrejs/dagre';
import { Box, Button, Divider, Typography } from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import React, { useContext, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  useNodesState,
  Controls,
  Background,
  NodeChange,
  EdgeChange,
  Connection,
  ControlButton,
  Edge,
  useEdgesState,
  MarkerType,
  NodeTypes,
  NodeProps,
  EdgeMarkerType,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { OperationNode } from './Nodes/OperationNode';
import { DbtSourceModelNode } from './Nodes/DbtSourceModelNode';
import { useSession } from 'next-auth/react';
import { httpDelete, httpGet } from '@/helpers/http';
import { successToast } from '@/components/ToastMessage/ToastHelper';
import { GlobalContext } from '@/contexts/ContextProvider';
import OperationConfigLayout from './OperationConfigLayout';
import { OPERATION_NODE, SRC_MODEL_NODE } from '../constant';
import {
  useCanvasAction,
  useCanvasNode,
} from '@/contexts/FlowEditorCanvasContext';
import { usePreviewAction } from '@/contexts/FlowEditorPreviewContext';

type CanvasProps = {
  redrawGraph: boolean;
  setRedrawGraph: (...args: any) => void;
};

const nodeGap = 30;

export interface OperationNodeData {
  id: string;
  output_cols: Array<string>;
  type: typeof OPERATION_NODE;
  target_model_id: string;
  config: any;
  isDummy?: boolean;
  prev_source_columns?: string[];
  is_last_in_chain?: boolean;
  seq?: number;
}

export type DbtSourceModel = {
  source_name: string;
  input_name: string;
  input_type: 'model' | 'source';
  schema: string;
  id: string;
  type: typeof SRC_MODEL_NODE;
  isDummy?: boolean;
};

// export interface OperationNodeType extends NodeProps {
//   data: OperationNodeData;
// }
export type OperationNodeType = NodeProps<OperationNodeData>;

// export interface SrcModelNodeType extends NodeProps {
//   data: DbtSourceModel;
// }
export type SrcModelNodeType = NodeProps<DbtSourceModel>;

type CustomNode = OperationNodeType | SrcModelNodeType;

type EdgeData = {
  id: string;
  source: string;
  target: string;
};

type DbtProjectGraphApiResponse = {
  nodes: Array<DbtSourceModel | OperationNodeData>;
  edges: EdgeData[];
};

type EdgeStyleProps = {
  markerEnd?: EdgeMarkerType;
  markerStart?: EdgeMarkerType;
};

export interface UIOperationType {
  slug: string;
  label: string;
  infoToolTip?: string;
}

const nodeTypes: NodeTypes = {
  [`${SRC_MODEL_NODE}`]: DbtSourceModelNode,
  [`${OPERATION_NODE}`]: OperationNode,
};

export const getNextNodePosition = (nodes: any) => {
  let rightMostX = nodes && nodes.length > 0 ? Number.NEGATIVE_INFINITY : 0;
  let rightMostY = 0;
  let rightMostHeight = 0;

  for (const node of nodes) {
    if (node.position.x > rightMostX) {
      rightMostX = node.position.x;
      rightMostY = node.position.y;
      rightMostHeight = node.height;
    }
  }

  // Position the new node below the right-most element with a gap
  const x = rightMostX;
  const y = rightMostY + rightMostHeight + nodeGap;

  return { x, y };
};

const CanvasHeader = ({
  setCanvasAction,
}: {
  setCanvasAction: (...args: any) => void;
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        flexDirection: 'space-between',
        justifyContent: 'center',
        padding: '0 20px',
        gap: '10px',
      }}
    >
      <Typography variant="h6" sx={{ marginLeft: 'auto' }}>
        Workflow01
      </Typography>

      <Box sx={{ marginLeft: 'auto', display: 'flex', gap: '20px' }}>
        <Button
          variant="contained"
          type="button"
          onClick={() => setCanvasAction({ type: 'run-workflow', data: null })}
        >
          Run
        </Button>
      </Box>
    </Box>
  );
};

const defaultViewport = { x: 0, y: 0, zoom: 0.8 };

const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = ({
  nodes,
  edges,
  options,
}: {
  nodes: CustomNode[];
  edges: Edge[];
  options: { direction: string };
}) => {
  g.setGraph({
    rankdir: options.direction,
    nodesep: 200,
    edgesep: 100,
    width: 250,
    height: 120,
    marginx: 100,
    marginy: 100,
    ranksep: 350,
  });

  edges.forEach((edge: Edge) => g.setEdge(edge.source, edge.target));
  nodes.forEach((node: CustomNode) => g.setNode(node.id, {}));

  // build the layout
  Dagre.layout(g);

  return {
    nodes: nodes.map((node: CustomNode) => {
      const { x, y } = g.node(node.id);

      return { ...node, position: { x, y } };
    }),
    edges,
  };
};

const Canvas = ({ redrawGraph, setRedrawGraph }: CanvasProps) => {
  const { data: session } = useSession();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [openOperationConfig, setOpenOperationConfig] =
    useState<boolean>(false);
  const { addNodes, setCenter, getZoom } = useReactFlow();

  const { canvasAction, setCanvasAction } = useCanvasAction();
  const { canvasNode } = useCanvasNode();
  const { previewAction, setPreviewAction } = usePreviewAction();
  const previewNodeRef = useRef<DbtSourceModel | null>();
  const globalContext = useContext(GlobalContext);
  const EdgeStyle: EdgeStyleProps = {
    markerEnd: {
      type: MarkerType.Arrow,
      width: 20,
      height: 20,
      color: 'black',
    },
  };

  const fetchDbtProjectGraph = async () => {
    try {
      const response: DbtProjectGraphApiResponse = await httpGet(
        session,
        'transform/dbt_project/graph/'
      );
      const nodes: Array<DbtSourceModel | OperationNodeData | any> =
        response.nodes.map((nn: DbtSourceModel | OperationNodeData) => ({
          id: nn.id,
          type: nn.type,
          data: nn,
        }));
      const edges: Edge[] = response.edges.map((edgeData: EdgeData) => ({
        ...edgeData,
        ...EdgeStyle,
      }));

      const { nodes: layoutedNodes, edges: layoutedEdges } =
        getLayoutedElements({
          nodes: nodes,
          edges: edges,
          options: { direction: 'LR' },
        });

      setNodes([...layoutedNodes]);
      setEdges([...layoutedEdges]);
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (session) fetchDbtProjectGraph();
  }, [session, redrawGraph]);

  useEffect(() => {
    previewNodeRef.current = previewAction.data;
  }, [previewAction]);

  const handleNodesChange = (changes: NodeChange[]) => {
    console.log(
      'inside handle nodes changes; changes include move, drag and select'
    );
    console.log('node changes', changes);
    onNodesChange(changes);
  };

  const handleEdgesChange = (changes: EdgeChange[]) => {
    console.log(
      'inside handle edges changes; changes include select and remove'
    );
    onEdgesChange(changes);
  };

  const handleNewConnection = (connection: Connection) => {
    console.log(
      'inside handle new connection; when two nodes are connected by user',
      connection
    );
    if (connection.source && connection.target) {
      const newEdge: Edge = {
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
        id: `${connection.source}_${connection.target}`,
        ...EdgeStyle,
      };
      handleEdgesChange([{ type: 'add', item: newEdge }]);
    }
  };

  const handleDeleteNode = async (
    nodeId: string,
    type: string,
    shouldRefreshGraph = true,
    isDummy = false
  ) => {
    console.log('deleting a node with id ', nodeId);
    // remove the node from preview if its there

    if (!isDummy) {
      // remove node from canvas
      if (type === SRC_MODEL_NODE) {
        // hit the backend api to remove the node in a try catch
        try {
          await httpDelete(session, `transform/dbt_project/model/${nodeId}/`);
        } catch (error) {
          console.log(error);
        }
      } else if (type === OPERATION_NODE) {
        // hit the backend api to remove the node in a try catch
        try {
          await httpDelete(
            session,
            `transform/dbt_project/model/operations/${nodeId}/`
          );
        } catch (error) {
          console.log(error);
        }
      }
    }

    handleNodesChange([{ type: 'remove', id: nodeId }]);
    if (nodeId === canvasNode?.id || isDummy) {
      setCanvasAction({
        type: 'close-reset-opconfig-panel',
        data: null,
      });
    }
    if (shouldRefreshGraph) setRedrawGraph(!redrawGraph);
  };

  const addSrcModelNodeToCanvas = (
    dbtSourceModel: DbtSourceModel | null | undefined
  ) => {
    if (dbtSourceModel) {
      const position = getNextNodePosition(nodes);
      const newNode = {
        id: dbtSourceModel.id,
        type: SRC_MODEL_NODE,
        data: dbtSourceModel,
        position,
      };
      // handleNodesChange([{ type: 'add', item: newNode }]);
      addNodes([newNode]);
      setCenter(position.x, position.y, {
        zoom: getZoom(),
        duration: 500,
      });
    }
  };

  const addOperationNodeToCanvas = (
    operationNode: OperationNodeData | null | undefined
  ) => {
    if (operationNode) {
      console.log('adding an operation node to canvas', operationNode);
      const newNode = {
        id: operationNode.id,
        type: OPERATION_NODE,
        data: operationNode,
        position: { x: 100, y: 125 },
      };
      // handleNodesChange([{ type: 'add', item: newNode }]);
      addNodes([newNode]);
    }
  };

  const handleRefreshCanvas = () => {
    setRedrawGraph(!redrawGraph);
  };

  useEffect(() => {
    // This event is triggered via the ProjectTree component
    if (canvasAction.type === 'add-srcmodel-node') {
      addSrcModelNodeToCanvas(canvasAction.data);
    }

    if (canvasAction.type === 'refresh-canvas') {
      handleRefreshCanvas();
    }

    if (canvasAction.type === 'delete-node') {
      handleDeleteNode(
        canvasAction.data.nodeId,
        canvasAction.data.nodeType,
        canvasAction.data.shouldRefreshGraph, // by default always refresh canvas
        canvasAction.data.isDummy !== undefined
          ? canvasAction.data.isDummy
          : false
      );
    }
  }, [canvasAction]);

  const onNodeDragStop = (event: any, node: any) => {
    let x = node.position.x;
    let y = node.position.y;

    nodes.forEach((otherNode) => {
      if (otherNode.id === node.id) return;

      const xOverlap = Math.max(
        0,
        Math.min(
          node.position.x + node.width,
          otherNode.position.x + (otherNode.width || 0)
        ) - Math.max(node.position.x, otherNode.position.x)
      );
      const yOverlap = Math.max(
        0,
        Math.min(
          node.position.y + node.height,
          otherNode.position.y + (otherNode.height || 0)
        ) - Math.max(node.position.y, otherNode.position.y)
      );
      if (xOverlap > 0 && yOverlap > 0) {
        // Prevent overlap by adjusting position
        if (x < otherNode.position.x) {
          x -= xOverlap + nodeGap;
        } else {
          x += xOverlap + nodeGap;
        }

        if (y < otherNode.position.y) {
          y -= yOverlap + nodeGap;
        } else {
          y += yOverlap + nodeGap;
        }
      }
    });

    setNodes((nds) =>
      nds.map((nd) => {
        if (nd.id === node.id) {
          // Update the position of the node being dragged
          return {
            ...nd,
            position: {
              x,
              y,
            },
          };
        }
        return nd;
      })
    );
  };

  const handlePaneClick = () => {
    setCanvasAction({ type: 'close-reset-opconfig-panel', data: null });
    setPreviewAction({ type: 'clear-preview', data: null });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <Box
        sx={{
          height: '44px',
          background: '#F5FAFA',
          borderTop: '1px #CCD6E2 solid',
        }}
      >
        <CanvasHeader setCanvasAction={setCanvasAction} />
      </Box>
      <Divider orientation="horizontal" sx={{ color: 'black' }} />
      <Box
        sx={{
          display: 'flex',
          height: 'calc(100% - 44px)',
          background: 'white',
        }}
      >
        <ReactFlow
          nodes={nodes}
          selectNodesOnDrag={false}
          edges={edges}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={handlePaneClick}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleNewConnection}
          nodeTypes={nodeTypes}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
          defaultViewport={defaultViewport}
          fitView
        >
          <Background />
          <Controls>
            <ControlButton
              onClick={() => {
                successToast('Graph has been refreshed', [], globalContext);
                setRedrawGraph(!redrawGraph);
              }}
            >
              <ReplayIcon />
            </ControlButton>
          </Controls>
        </ReactFlow>
        <OperationConfigLayout
          openPanel={openOperationConfig}
          setOpenPanel={setOpenOperationConfig}
          sx={{
            background: '#FFFFFF',
            width: '500px',
            boxShadow: '0px 0px 4px 0px rgba(0, 0, 0, 0.16)',
            borderRadius: '6px 0px 0px 6px',
            zIndex: 1000,
          }}
        />
      </Box>
    </Box>
  );
};

export default Canvas;
