import { blocks } from '../syllabus'

export const labBlocks = blocks.filter(block => block.id === 'b2' || block.id === 'b3' || block.id === 'b4')
export const labTopics = labBlocks.flatMap(block =>
  block.topics.map(topic => ({ id: `${block.roman}.${topic.number}`, block: block.roman, title: topic.title })))

export const isBasicTechnologyTopic = (topicId: string) => topicId.startsWith('II.')
