/** Styled pieces shared by the slicer side-panel sections. */
import styled from 'styled-components';

export const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-top: 0.45rem;
  border-top: 1px solid #383838;
`;

export const SectionHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #9e9e9e;
  font-weight: 600;
`;

export const SmallButton = styled.button`
  background: ${(p) => (p.$active ? '#4caf50' : '#383838')};
  border: 1px solid ${(p) => (p.$active ? '#4caf50' : '#4a4a4a')};
  color: #fff;
  border-radius: 5px;
  padding: 0.18rem 0.45rem;
  font-size: 0.7rem;
  cursor: pointer;

  &:hover {
    background: ${(p) => (p.$active ? '#45a049' : '#4a4a4a')};
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
`;

export const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;

  th {
    text-align: left;
    color: #9e9e9e;
    font-weight: 600;
    padding: 0.1rem 0.2rem;
  }
  td {
    padding: 0.1rem 0.2rem;
    border-top: 1px solid #2e2e2e;
  }
  tr.clickable {
    cursor: pointer;
  }
  tr.clickable:hover td {
    background: #2e2e2e;
  }
`;

export const Bad = styled.span`
  color: #ff6e6e;
  font-weight: 600;
`;
export const Good = styled.span`
  color: #81c784;
`;
export const Warn = styled.span`
  color: #ffb74d;
`;

export const Steps = styled.ol`
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.68rem;
  line-height: 1.45;

  li.done {
    color: #81c784;
  }
  li.current {
    color: #fff;
    font-weight: 600;
  }
`;

export const SmallSelect = styled.select`
  background: #383838;
  border: 1px solid #4a4a4a;
  color: #fff;
  border-radius: 5px;
  padding: 0.15rem 0.3rem;
  font-size: 0.7rem;
  max-width: 100%;
`;

export const Note = styled.div`
  font-size: 0.64rem;
  line-height: 1.4;
  color: #9e9e9e;
`;
