export interface Link {
  id: number;
  url: string;
  title: string;
  description: string;
  tags: string[];
  created_at: string;
}

export interface LinkAnalysis {
  title: string;
  description: string;
  tags: string[];
}
