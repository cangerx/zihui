<?php

return [
    // Qdrant 向量数据库连接信息（url / api_key / collection）改由云控端
    // 「知识库设置」管理（SystemSetting: kb_qdrant_url / kb_qdrant_api_key / kb_qdrant_collection），
    // 不再走 .env。以下仅为协议 / 性能默认值，一般无需修改。

    // 距离度量：Cosine（embedding 归一化后等价于余弦相似度，score 越大越相似）
    'distance' => 'Cosine',

    'timeout' => 20,
    'connect_timeout' => 5,

    // collection 兜底名（SystemSetting kb_qdrant_collection 为空时使用）
    'default_collection' => 'kb_chunks',
];
