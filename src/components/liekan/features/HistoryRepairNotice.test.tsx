import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),put:vi.fn(),pathname:'/websites'}));
vi.mock('@/lib/liekan/upstream/client',()=>({useNavigation:()=>({pathname:mocks.pathname})}));
vi.mock('@/lib/liekan/upstream/features-client',()=>({featureApi:{get:mocks.get,put:mocks.put}}));
vi.mock('@/components/liekan/Link',()=>({default:({children,prefetch:_,...props}:any)=><a {...props}>{children}</a>}));
vi.mock('./ui',()=>({
  Button:({children,onClick,disabled}:any)=><button disabled={disabled} onClick={onClick}>{children}</button>,
  DialogActions:({children}:any)=><footer>{children}</footer>,
  LiekanDialog:({children,title}:any)=><section role="dialog" aria-label={title}>{children}</section>,
  Notice:({children}:any)=><p>{children}</p>,
}));
import { HistoryRepairNotice } from './HistoryRepairNotice';
const base={campaignId:'traffic-quality-repair-20261022-v1',engineVersion:'history-repair-v1.1',supported:true,dismissed:false,unreadCompletion:false,hasEligibleData:true,websites:[]};
beforeEach(()=>{vi.resetAllMocks();mocks.pathname='/websites';mocks.get.mockResolvedValue(base);mocks.put.mockResolvedValue({});});
it('offers upgrade guidance without starting a repair and persists dismiss explicitly',async()=>{
 render(<HistoryRepairNotice userId="owner" />);
 expect(await screen.findByRole('dialog',{name:'升级后可检查历史数据'})).toBeVisible();
 expect(mocks.put).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'稍后处理'}));
 await waitFor(()=>expect(mocks.put).toHaveBeenCalledWith('/liekan/history-repair',{campaignId:base.campaignId,action:'dismiss'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('reads completion on return to the window without polling ordinary reports',async()=>{
 mocks.get.mockResolvedValue({...base,dismissed:true});
 render(<HistoryRepairNotice userId="owner" />);
 await waitFor(()=>expect(mocks.get).toHaveBeenCalledTimes(1));
 expect(screen.queryByRole('dialog')).toBeNull();
 mocks.get.mockResolvedValue({...base,dismissed:true,unreadCompletion:true});
 fireEvent.focus(window);
 expect(await screen.findByRole('dialog',{name:'历史数据修复已完成'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'知道了'}));
 await waitFor(()=>expect(mocks.put).toHaveBeenCalledWith('/liekan/history-repair',{campaignId:base.campaignId,action:'read'}));
});
it('does not offer the campaign for a fresh installation or unsupported backend',async()=>{
 mocks.get.mockResolvedValue({...base,hasEligibleData:false});
 const view=render(<HistoryRepairNotice userId="owner" />);
 await waitFor(()=>expect(mocks.get).toHaveBeenCalledTimes(1));
 expect(screen.queryByRole('dialog')).toBeNull();
 mocks.get.mockResolvedValue({...base,supported:false});
 mocks.pathname='/settings';view.rerender(<HistoryRepairNotice userId="owner" />);
 await waitFor(()=>expect(mocks.get).toHaveBeenCalledTimes(2));
 expect(screen.queryByRole('dialog')).toBeNull();
});
