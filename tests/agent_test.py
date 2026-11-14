import unittest,sys,time,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'agent'))
import cleanup
class CleanupTest(unittest.TestCase):
 def test_protects_named_and_used_images_and_rechecks_preview(self):
  with tempfile.TemporaryDirectory() as tmp:
   cleanup.KEY_FILE=Path(tmp)/'key';cleanup.KEY_FILE.write_text('test-only-key')
   rows=[{'Id':'old','Containers':0,'Created':time.time()-8*86400,'RepoTags':[]},{'Id':'named','Containers':0,'Created':0,'RepoTags':['app:rollback']},{'Id':'used','Containers':1,'Created':0,'RepoTags':[]}];deleted=[]
   def docker(path,method='GET'):
    if method=='DELETE':deleted.append(path);return []
    return {'Images':rows}
   cleanup.insights.docker=docker
   preview=cleanup.preview();self.assertEqual([i['id'] for i in preview['images']],['old'])
   with self.assertRaises(ValueError):cleanup.apply({'ticket':preview['ticket'],'ids':['named'],'confirmation':'DELETE'})
   rows[0]['Containers']=1;result=cleanup.apply({'ticket':preview['ticket'],'ids':['old'],'confirmation':'DELETE'});self.assertFalse(result['results'][0]['deleted']);self.assertEqual(deleted,[])
class SwarmTest(unittest.TestCase):
 def test_service_down_needs_two_checks_and_recovers(self):
  import insights
  state={'tasks':[]}
  services=[{'ID':'s1','Spec':{'Name':'site','Mode':{'Replicated':{'Replicas':1}}}},{'ID':'g1','Spec':{'Name':'agent','Mode':{'Global':{}}}}]
  def docker(path,method='GET'):
   if path=='/services':return services
   if path.startswith('/tasks'):return state['tasks']
   raise OSError('unexpected '+path)
  insights.docker=docker;insights._data['events']=[];insights._services_prev.clear()
  state['tasks']=[{'ServiceID':'s1','UpdatedAt':'2','Status':{'State':'preparing','Err':'No such image: site:latest'}}]
  insights.swarm();self.assertEqual(insights._data['events'],[]);self.assertEqual(insights._data['services'][0]['running'],0)
  insights.swarm();self.assertEqual([e['kind'] for e in insights._data['events']],['service-down']);self.assertIn('No such image',insights._data['services'][0]['error'])
  insights.swarm();self.assertEqual(len(insights._data['events']),1,'one incident per outage')
  state['tasks']=[{'ServiceID':'s1','UpdatedAt':'3','Status':{'State':'running'}}]
  insights.swarm();self.assertEqual([e['kind'] for e in insights._data['events']],['service-down','recovered']);self.assertIsNone(insights._data['services'][0]['error'])
  self.assertEqual([x['name'] for x in insights._data['services']],['site'],'global services are ignored')
 def test_not_a_swarm_manager(self):
  import insights
  def docker(path,method='GET'):raise OSError('Docker HTTP 503')
  insights.docker=docker;insights.swarm();self.assertIsNone(insights._data['services'])
if __name__=='__main__':unittest.main()
